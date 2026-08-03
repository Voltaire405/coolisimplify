# 0001 Server identity comes from the embedded destination.server

The Coolify API never populates a top-level `server_id` on resources, and `GET /servers` does not return a reliable top-level `id` either — joining the two was matching `undefined === undefined` and silently producing wrong results. We therefore read a resource's server from the server object embedded at `destination.server` and never join on server ids. Any code that needs a server name uses `resource.destination?.server?.name` directly.
