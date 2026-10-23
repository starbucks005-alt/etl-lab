"""Text-only questions for the robot, on an Azure OpenAI / AI Foundry model when one is set up, else on Claude (2026-10-23, Dr. O).

Dr. O asked for the robots' charge to move to Azure and off Claude. This is the switch. It is OFF until Azure model settings exist,
so with nothing set the robot asks Claude exactly as before. If Azure is set up and answers badly (wrong key, no quota, a timeout),
the same question goes to Claude, so the robot never goes quiet in front of a visitor.

Settings, the same names the website uses (AZURE_OPENAI_*), from the environment or from azure_model.json beside this file
(kept out of git): {"endpoint": "https://<resource>.openai.azure.com", "key": "...", "deployment": "<the name you gave the model>"}.
Optional in that file: "api_version" (default 2024-10-21), "token_param" ("max_completion_tokens" or "max_tokens"), and "on": false
to send everything back to Claude without removing the settings.

Not used here on purpose: the photo and file readers (they send pictures and documents) and the robot's main spoken reply, which
is made inside ~/al.py on the Pi. Both stay on Claude.

NOT TRIED against the real Azure service or on the robot. The request follows the published chat completions call. Which
deployment name, and whether the model sounds right in each voice, is for Dr. O to check on one robot first.
"""
import json
import os

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_FILE = os.path.join(HERE, "azure_model.json")
DEFAULT_API_VERSION = "2024-10-21"
_LAST = {"source": "claude"}          # which service answered the last question, for the log line and the status check


def azure_model_cfg():
    """The Azure model settings as a dict, or None when they are not all there or "on" is false."""
    f = {}
    try:
        with open(MODEL_FILE) as fh:
            f = json.load(fh)
    except (OSError, ValueError):
        pass
    if not isinstance(f, dict) or f.get("on") is False:
        return None
    endpoint = (os.environ.get("AZURE_OPENAI_ENDPOINT") or f.get("endpoint") or "").strip().rstrip("/")
    key = (os.environ.get("AZURE_OPENAI_KEY") or f.get("key") or "").strip()
    deployment = (os.environ.get("AZURE_OPENAI_DEPLOYMENT") or f.get("deployment") or "").strip()
    if not (endpoint.startswith("https://") and key and deployment):
        return None
    return {
        "endpoint": endpoint, "key": key, "deployment": deployment,
        "api_version": (os.environ.get("AZURE_OPENAI_API_VERSION") or f.get("api_version") or DEFAULT_API_VERSION).strip(),
        "token_param": f.get("token_param") if f.get("token_param") in ("max_tokens", "max_completion_tokens") else "max_completion_tokens",
    }


def _azure_text(cfg, system, user, max_tokens, timeout):
    url = "%s/openai/deployments/%s/chat/completions" % (cfg["endpoint"], requests.utils.quote(cfg["deployment"], safe=""))
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
    param = cfg["token_param"]
    for attempt in (0, 1):
        r = requests.post(url, params={"api-version": cfg["api_version"]},
                          headers={"api-key": cfg["key"], "content-type": "application/json"},
                          json={"messages": messages, param: max_tokens}, timeout=timeout)
        # Some deployments want the other token setting. Say which one, then try once with it.
        if r.status_code == 400 and attempt == 0 and "max_" in r.text:
            param = "max_tokens" if param == "max_completion_tokens" else "max_completion_tokens"
            continue
        break
    if r.status_code != 200:
        raise RuntimeError("azure said %d: %s" % (r.status_code, r.text[:160]))
    choice = (r.json().get("choices") or [{}])[0]
    text = ((choice.get("message") or {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("azure sent no text (finish_reason %s)" % choice.get("finish_reason"))
    return text


def ask(system, user, max_tokens, timeout, claude):
    """One text question. `claude` is a function taking no arguments that asks Claude and returns the text, or raises."""
    cfg = azure_model_cfg()
    if cfg:
        try:
            text = _azure_text(cfg, system, user, max_tokens, timeout)
            if _LAST["source"] != "azure":
                print("MODEL answering on Azure (%s)" % cfg["deployment"], flush=True)
            _LAST["source"] = "azure"
            return text
        except Exception as e:
            print("MODEL Azure failed, asking Claude instead:", str(e)[:160], flush=True)
    _LAST["source"] = "claude"
    return claude()


def last_source():
    return _LAST["source"]
