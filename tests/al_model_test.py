"""Run: python3 -m unittest tests/al_model_test.py"""
import os, sys, unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "al-panel", "pi"))
import al_model  # noqa: E402

ENV = {"AZURE_OPENAI_ENDPOINT": "https://x.openai.azure.com/", "AZURE_OPENAI_KEY": "k", "AZURE_OPENAI_DEPLOYMENT": "mini"}


class Resp:
    def __init__(self, code, body=None, text=""):
        self.status_code, self._b, self.text = code, body or {}, text
    def json(self):
        return self._b


def ok(t):
    return Resp(200, {"choices": [{"message": {"content": t}, "finish_reason": "stop"}]})


class AskModel(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(al_model, "MODEL_FILE", "/nonexistent/azure_model.json"); p.start(); self.addCleanup(p.stop)

    def claude(self):
        return mock.Mock(return_value="from claude")

    def test_off_without_settings_asks_claude_only(self):
        c = self.claude()
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("requests.post") as post:
            self.assertEqual(al_model.ask(None, "hi", 50, 5, c), "from claude")
        post.assert_not_called()

    def test_azure_answers_and_claude_not_called(self):
        c = self.claude()
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch("requests.post", return_value=ok(" hello ")) as post:
            self.assertEqual(al_model.ask("sys", "hi", 50, 5, c), "hello")
        c.assert_not_called()
        self.assertIn("/openai/deployments/mini/chat/completions", post.call_args[0][0])
        self.assertEqual(post.call_args[1]["json"]["messages"][0], {"role": "system", "content": "sys"})
        self.assertEqual(post.call_args[1]["json"]["max_completion_tokens"], 50)

    def test_azure_error_falls_back_to_claude(self):
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch("requests.post", return_value=Resp(401, text="bad key")):
            self.assertEqual(al_model.ask(None, "hi", 50, 5, self.claude()), "from claude")

    def test_azure_empty_text_falls_back(self):
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch("requests.post", return_value=ok("")):
            self.assertEqual(al_model.ask(None, "hi", 50, 5, self.claude()), "from claude")

    def test_retries_with_other_token_setting(self):
        seq = [Resp(400, text="Unsupported parameter: 'max_completion_tokens'"), ok("fine")]
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch("requests.post", side_effect=seq) as post:
            self.assertEqual(al_model.ask(None, "hi", 50, 5, self.claude()), "fine")
        self.assertIn("max_tokens", post.call_args[1]["json"])

    def test_no_system_message_when_none(self):
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch("requests.post", return_value=ok("a")) as post:
            al_model.ask(None, "hi", 50, 5, self.claude())
        self.assertEqual([m["role"] for m in post.call_args[1]["json"]["messages"]], ["user"])

    def test_on_false_in_file_turns_it_off(self):
        import tempfile, json
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"on": False}, f)
        with mock.patch.object(al_model, "MODEL_FILE", f.name), mock.patch.dict(os.environ, ENV, clear=True):
            self.assertIsNone(al_model.azure_model_cfg())
        os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
