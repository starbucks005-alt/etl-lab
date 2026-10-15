# Azure setup (2026-10-14)

Four Azure services are wired in. Each is OFF until its settings exist, and none of them can break what already works.

| Service | Used by | Settings |
|---|---|---|
| Speech (voice and listening) | AL on the Pi (`al-panel/pi/al_panel_server.py`) | `azure_speech.json` on the Pi, or `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` |
| Blob Storage | Everly Castle voice cache, second copy (`netlify/functions/everly-castle-voice.js`) | Netlify: `AZURE_BLOB_SAS_URL` |
| AI Translator | `netlify/functions/azure-translate.js` | Netlify: `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION` |
| Azure OpenAI / AI Foundry model | `_azure.js` `chat()`, checked by `azure-status.js` | Netlify: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT` |

## Create them in the portal
1. **Speech**: Create a resource, "Speech". Copy a key and the region from Keys and Endpoint.
2. **Blob**: Create a Storage account, then a container (for example `etl-audio`). On the container, Shared access tokens:
   permissions Read, Write, Create, an expiry a year out. Copy the "Blob SAS URL" (the one that starts https and has a `?`).
3. **Translator**: Create a resource, "Translator". Copy a key and the region.
4. **Model**: Create an "Azure OpenAI" resource (or open AI Foundry), Deploy a model, for example `gpt-4o-mini`. The
   deployment name you type is `AZURE_OPENAI_DEPLOYMENT`. Copy the endpoint and a key.

## Check they work
After setting the Netlify variables and deploying, open `/.netlify/functions/azure-status?check=1`. It says which are
configured and makes one tiny real call to each. Translator by hand:

    curl -X POST https://<site>/.netlify/functions/azure-translate -H "Content-Type: application/json" -d '{"text":"Good morning","to":"es"}'

## Keys
Keys go in Netlify's environment variables and the Pi's `azure_speech.json` only. Never in the repo. The SAS URL is a
key too: treat it the same, and give it an expiry.

## Spend tracker (keeps the workloads above $1)
Reads what each Azure service has cost and emails a daily line saying whether enough workloads are counting for the
Microsoft for Startups milestone (5 for $25,000, 7 for $50,000, 10 for $150,000). It only reads. It cannot change or
spend anything.

1. **Make a read-only identity.** In the Azure portal open **Cloud Shell** (the `>_` icon, choose Bash) and run, with your
   own subscription id (Subscriptions page):

       az ad sp create-for-rbac --name etl-spend-reader --role "Cost Management Reader" --scopes /subscriptions/YOUR_SUBSCRIPTION_ID

   It prints `appId`, `password` and `tenant`. The password is shown once.
2. **Set these in Netlify** (Site configuration, Environment variables):

   | Variable | Value |
   |---|---|
   | `AZURE_TENANT_ID` | `tenant` from step 1 |
   | `AZURE_CLIENT_ID` | `appId` from step 1 |
   | `AZURE_CLIENT_SECRET` | `password` from step 1 |
   | `AZURE_SUBSCRIPTION_ID` | your subscription id |
   | `AZURE_SPEND_TOKEN` | a long random string you make up, for the status page |
   | `AZURE_TARGET_WORKLOADS` | optional, default 5 |
   | `ALERT_EMAIL_TO` | optional, default your lab address |

   Email uses the `RESEND_API_KEY` the site already has.
3. **Deploy**, then open the page (replace YOUR_TOKEN):

       https://<site>/.netlify/functions/azure-spend-status?token=YOUR_TOKEN&refresh=1

4. The daily email goes out at 12:00 UTC. A missing email means the tracker itself stopped.

Cost data can lag by up to a day, and the "streak" is an estimate. Microsoft's own count is in the Microsoft for Startups
portal. The tracker assumes a service must have spent at least $1 in the last 30 days and have some spend in the last 7.
The tracker cannot make a service spend: each workload has to be doing real work for the count to hold.
