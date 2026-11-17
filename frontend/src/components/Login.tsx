import { useState } from 'react'
import type { FormEvent } from 'react'
import { API } from '../auth'
import type { User } from '../auth'

interface LoginProps {
  onLogin: (token: string, user: User) => void
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20'

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isRegister = mode === 'register'

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register')
    setError('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, ...(isRegister ? { name } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
      onLogin(data.token, data.user)
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Cannot reach the server. Is the backend running on port 8000?'
          : (err as Error).message,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0B1424] via-[#101B2D] to-[#12304A] p-5">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-2xl shadow-lg shadow-emerald-500/20">
            ⚡
          </div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-white">EnergyPulse</h1>
          <p className="m-0 mt-1 text-[11px] font-semibold tracking-wider text-teal-400">2.0 ANALYTICS</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl backdrop-blur"
        >
          <h2 className="m-0 text-lg font-semibold text-white">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="m-0 mb-6 mt-1 text-sm text-slate-400">
            {isRegister ? 'Sign up to start analysing your energy data.' : 'Sign in to continue to your dashboard.'}
          </p>

          {isRegister && (
            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-300">Full name</span>
              <input
                className={inputClass}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Juan Dela Cruz"
                autoComplete="name"
              />
            </label>
          )}

          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-300">Username or email</span>
            <input
              className={inputClass}
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="username or email"
              autoComplete="username"
              autoFocus
              required
            />
          </label>

          <label className="mb-5 block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-300">Password</span>
            <div className="relative">
              <input
                className={`${inputClass} pr-16`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isRegister ? 'At least 8 characters' : '••••••••'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 border-0 bg-transparent text-xs font-semibold text-slate-400 hover:text-white"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl border-0 bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>

          <p className="m-0 mt-5 text-center text-sm text-slate-400">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={switchMode}
              className="border-0 bg-transparent p-0 font-semibold text-emerald-400 hover:underline"
            >
              {isRegister ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">EnergyPulse 2.0 · Professional Energy Analytics Platform</p>
      </div>
    </div>
  )
}