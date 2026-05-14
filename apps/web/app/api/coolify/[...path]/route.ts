import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

type RouteContext = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, ctx: RouteContext) {
  return proxy(request, 'GET', await ctx.params)
}
export async function POST(request: NextRequest, ctx: RouteContext) {
  return proxy(request, 'POST', await ctx.params)
}
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  return proxy(request, 'PATCH', await ctx.params)
}
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  return proxy(request, 'DELETE', await ctx.params)
}
export async function PUT(request: NextRequest, ctx: RouteContext) {
  return proxy(request, 'PUT', await ctx.params)
}

async function proxy(
  request: NextRequest,
  method: string,
  params: { path: string[] },
) {
  const coolifyUrl = request.headers.get('x-coolify-url')
  const coolifyToken = request.headers.get('x-coolify-token')

  if (!coolifyUrl || !coolifyToken) {
    return jsonResponse(
      { message: 'Missing Coolify URL or token. Configure in settings.' },
      401,
    )
  }

  const baseUrl = coolifyUrl.replace(/\/$/, '')
  const apiPath = params.path.join('/')
  const search = request.nextUrl.search
  const url = `${baseUrl}/api/v1/${apiPath}${search}`

  let body: string | undefined
  if (method !== 'GET' && method !== 'DELETE') {
    body = await request.text()
  }

  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${coolifyToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body || undefined,
    })

    const resBody = await res.text()
    const headers = noStoreHeaders(res.headers.get('content-type'))
    return new NextResponse(resBody, { status: res.status, headers })
  } catch (err) {
    return jsonResponse(
      {
        message:
          err instanceof Error ? err.message : 'Failed to reach Coolify instance',
      },
      502,
    )
  }
}

function noStoreHeaders(contentType: string | null): Headers {
  const headers = new Headers()
  headers.set('content-type', contentType || 'application/json')
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0')
  headers.set('pragma', 'no-cache')
  headers.set('expires', '0')
  return headers
}

function jsonResponse(body: unknown, status: number) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: noStoreHeaders('application/json'),
  })
}
