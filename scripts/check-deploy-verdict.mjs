// Verifies that the app can tell a *successful* deployment from a *failed* one.
//
// Background: Coolify has no "deploy" endpoint — the app calls start/restart,
// which answer "queued" and nothing else. The verdict used to be inferred by
// polling `GET /applications` and reading the container `status`. But that
// status describes the *running container*, not the deployment: while a build
// runs (and after it fails) the previous container is still up and still says
// `running:healthy`. So the two scenarios below emit an identical container
// status stream, and anything judging by container status alone must call both
// a success — which is exactly what shipped.
//
// Run with: pnpm check:deploy-verdict
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { componentSchema } from './coolify-spec.mjs'
import { CoolifyClient } from '../apps/web/lib/coolify-client.ts'
import {
  judgeAction,
  classifyDeploymentStatus,
  isUnhealthy,
  CONVERGENCE_GRACE_MS,
} from '../apps/web/lib/deploy-verdict.ts'

const APP_UUID = 'app-uuid-1'
const DEPLOYMENT_UUID = 'dep-abc123'

// --- the two scenarios -------------------------------------------------------
// Same application, same action (Deploy), same container status at every poll.
// The ONLY difference is how the deployment itself ended.
const SCENARIOS = {
  success: { deploymentStatus: 'finished' },
  // Build explodes at ~40s (bad Dockerfile, failing test, registry auth).
  // Coolify leaves the previous container untouched and running.
  failure: { deploymentStatus: 'failed' },
}
// Identical in both: the old container never stops being healthy.
const containerStatusAt = () => 'running:healthy'

// --- fake Coolify ------------------------------------------------------------
let activeScenario = 'failure'
let deploymentQueries = 0

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const json = (body, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (req.method === 'POST' && url.pathname === `/applications/${APP_UUID}/start`) {
    // What Coolify actually answers: the request was *queued*. Nothing here
    // says anything about the outcome.
    return json({
      message: 'Deployment request queued.',
      deployment_uuid: DEPLOYMENT_UUID,
    })
  }
  if (req.method === 'GET' && url.pathname === '/applications') {
    return json([
      { uuid: APP_UUID, name: 'api', status: containerStatusAt(), build_pack: 'nixpacks' },
    ])
  }
  if (req.method === 'GET' && url.pathname === `/deployments/${DEPLOYMENT_UUID}`) {
    deploymentQueries++
    return json({
      deployment_uuid: DEPLOYMENT_UUID,
      status: SCENARIOS[activeScenario].deploymentStatus,
      logs: '[]',
    })
  }
  if (
    req.method === 'GET' &&
    url.pathname === `/deployments/applications/${APP_UUID}`
  ) {
    // The real envelope, NOT the bare array the spec documents — verified
    // against a live v4 instance. Reading this as an array yields an empty
    // history forever, and the build logs silently never appear.
    return json({
      count: 2,
      deployments: [
        { deployment_uuid: DEPLOYMENT_UUID, status: 'failed', logs: '[]' },
        { deployment_uuid: 'dep-older', status: 'finished', logs: '[]' },
      ],
    })
  }
  return json({ message: 'Not found' }, 404)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

// The real client fetches `/api/coolify${path}` through the Next proxy route;
// point that at the fake instance so the client's own request and error
// handling is what runs here.
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const path = String(input).replace(/^\/api\/coolify/, '')
  return realFetch(`${base}${path}`, init)
}

const client = new CoolifyClient({ baseUrl: base, token: 'test-token' })

// --- drive a deploy end to end ----------------------------------------------
const POLL_INTERVAL_MS = 3000
const TIMEOUT_MS = 5 * 60_000

/** Same poll loop the app runs, on a virtual clock so the check stays fast. */
async function runDeploy() {
  const start = await client.startApplication(APP_UUID)
  const deploymentUuid = start.deployment_uuid
  for (let elapsed = 0; elapsed < TIMEOUT_MS; elapsed += POLL_INTERVAL_MS) {
    const apps = await client.listApplications()
    const resource = apps.find((a) => a.uuid === APP_UUID)
    const deployment = deploymentUuid
      ? await client.getDeployment(deploymentUuid)
      : undefined
    const verdict = judgeAction({
      action: 'deploy',
      resourcePresent: !!resource,
      containerStatus: resource?.status,
      deploymentStatus: deployment?.status,
      elapsedMs: elapsed,
    })
    if (verdict !== 'waiting') return verdict
  }
  return 'timeout'
}

activeScenario = 'failure'
const failureVerdict = await runDeploy()
activeScenario = 'success'
const successVerdict = await runDeploy()

console.log(`  deployment truly failed    -> app verdict: ${failureVerdict}`)
console.log(`  deployment truly succeeded -> app verdict: ${successVerdict}`)

assert.notEqual(
  failureVerdict,
  successVerdict,
  `a failed deployment and a successful one produce the same verdict ` +
    `("${failureVerdict}"): the app reports a broken deploy as done, clears the ` +
    `pending pill and drops the Redeploy-needed chip (ADR-0005) for a change ` +
    `that was never applied`,
)
assert.equal(failureVerdict, 'failed', 'a failed deployment must be reported as failed')
assert.equal(successVerdict, 'succeeded')
assert.ok(deploymentQueries > 0, 'the verdict never consulted the deployment record')

// --- the history endpoint's real shape --------------------------------------
// The client must unwrap `{ count, deployments }`; the spec's bare array is a
// lie that would leave the build-log view permanently empty.
const history = await client.listApplicationDeployments(APP_UUID, { take: 2 })
assert.ok(Array.isArray(history), 'listApplicationDeployments must yield an array')
assert.equal(history.length, 2)
// Newest first, as the instance returns them.
assert.equal(history[0].deployment_uuid, DEPLOYMENT_UUID)

// --- the judge's own rules ---------------------------------------------------
// These three are the only terminal values a live v4 instance produced across
// 194 real deployment records (157 finished, 35 failed, 2 cancelled-by-user).
assert.equal(classifyDeploymentStatus('finished'), 'succeeded')
assert.equal(classifyDeploymentStatus('failed'), 'failed')
assert.equal(classifyDeploymentStatus('cancelled-by-user'), 'cancelled')
// Non-terminal states must not be mistaken for an outcome.
assert.equal(classifyDeploymentStatus('queued'), 'pending')
assert.equal(classifyDeploymentStatus('in_progress'), 'pending')
// An unknown future status is not evidence of success.
assert.equal(classifyDeploymentStatus('rolling-back'), 'pending')
assert.equal(classifyDeploymentStatus(undefined), 'pending')

const judge = (over) =>
  judgeAction({
    action: 'deploy',
    resourcePresent: true,
    containerStatus: 'running:healthy',
    elapsedMs: 60_000,
    ...over,
  })

// A cancelled deployment is not a success.
assert.equal(judge({ deploymentStatus: 'cancelled-by-user' }), 'failed')
// Still building: keep waiting, however healthy the old container looks.
assert.equal(judge({ deploymentStatus: 'in_progress' }), 'waiting')
// `finished` but the container died right after — a crash-loop is a failed
// deploy, not a done one.
assert.equal(
  judge({ deploymentStatus: 'finished', containerStatus: 'exited (1)' }),
  'failed',
)
// …with the listing given its grace window to catch up first.
assert.equal(
  judge({
    deploymentStatus: 'finished',
    containerStatus: 'exited (1)',
    elapsedMs: CONVERGENCE_GRACE_MS - 1,
  }),
  'waiting',
)
// A failing healthcheck is not a working deploy.
assert.ok(isUnhealthy('running (unhealthy)'))
assert.equal(
  judge({ deploymentStatus: 'finished', containerStatus: 'running (unhealthy)' }),
  'failed',
)
// `running:unknown` is a container with no healthcheck defined — roughly half
// of a real instance's applications. Absent a healthcheck there is nothing to
// fail, so a finished deployment on one is a success, not a suspicion.
assert.ok(!isUnhealthy('running:unknown'))
assert.equal(
  judge({ deploymentStatus: 'finished', containerStatus: 'running:unknown' }),
  'succeeded',
)

// --- fallback path: Services and Databases have no deployment handle ---------
const svc = (over) =>
  judgeAction({ action: 'restart', resourcePresent: true, elapsedMs: 60_000, ...over })

assert.equal(svc({ containerStatus: 'running:healthy' }), 'succeeded')
assert.equal(svc({ containerStatus: 'running:unknown' }), 'succeeded')
// `starting`/`restarting` are transitioning, not arrived. Counting them as
// active is what let the old judge declare victory mid-flight.
assert.equal(svc({ containerStatus: 'restarting' }), 'waiting')
assert.equal(svc({ containerStatus: 'starting' }), 'waiting')
assert.equal(svc({ containerStatus: 'running (unhealthy)' }), 'waiting')
// The elapsed-age gate still applies, so a restart cannot resolve against the
// status of the container it is about to replace.
assert.equal(
  svc({ containerStatus: 'running:healthy', elapsedMs: CONVERGENCE_GRACE_MS - 1 }),
  'waiting',
)
// stop must see a genuinely stopped container, not merely "not active".
assert.equal(
  judgeAction({
    action: 'stop',
    resourcePresent: true,
    containerStatus: 'exited (0)',
    elapsedMs: 10_000,
  }),
  'succeeded',
)
assert.equal(
  judgeAction({
    action: 'stop',
    resourcePresent: true,
    containerStatus: 'stopping',
    elapsedMs: 10_000,
  }),
  'waiting',
)
// delete converges on disappearance.
assert.equal(
  judgeAction({ action: 'delete', resourcePresent: false, elapsedMs: 1000 }),
  'succeeded',
)
assert.equal(
  judgeAction({ action: 'delete', resourcePresent: true, elapsedMs: 1000 }),
  'waiting',
)

// --- the page must actually use the judge -----------------------------------
// Guards against the fix living only in the library while the UI keeps its own
// inline rule.
const pageSource = readFileSync(
  join(import.meta.dirname, '..', 'apps', 'web', 'app', 'page.tsx'),
  'utf8',
)
assert.ok(
  pageSource.includes('judgeAction'),
  'page.tsx does not use judgeAction — the verdict is still derived inline',
)
assert.ok(
  !/const active = isResourceActive\(resource\.status\)/.test(pageSource),
  'page.tsx still judges convergence by container status alone',
)

// --- the contract the fix depends on ----------------------------------------
const deployment = componentSchema('ApplicationDeploymentQueue')
assert.ok(deployment.status, '`status` disappeared from ApplicationDeploymentQueue')
assert.ok(deployment.deployment_uuid, '`deployment_uuid` disappeared from the schema')
const clientMethods = Object.getOwnPropertyNames(CoolifyClient.prototype)
assert.ok(
  clientMethods.includes('getDeployment'),
  'CoolifyClient can no longer query a deployment',
)

server.close()
globalThis.fetch = realFetch
console.log('PASS — a failed deployment is distinguishable from a successful one')
