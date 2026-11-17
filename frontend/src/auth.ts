const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export type User = { username: string; name: string; role: 'admin' | 'user' }

const TOKEN_KEY = 'ep_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)

export const setToken = (token: string | null) => {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn
}

/** fetch() that attaches the sign-in token and signs the user out if the server says 401. */
export async function authFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) onUnauthorized?.()
  return res
}