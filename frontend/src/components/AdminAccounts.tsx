import { useCallback, useEffect, useMemo, useState } from 'react'
import { API, authFetch } from '../auth'

type Account = { username: string; name: string; role: string; created: number | null }
type Form = { username: string; name: string; password: string; role: 'user' | 'admin' }

const emptyForm: Form = { username: '', name: '', password: '', role: 'user' }
const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500'

export default function AdminAccounts({ currentUsername }: { currentUsername: string }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)   // username being edited, null = adding
  const [form, setForm] = useState<Form>(emptyForm)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await authFetch(`${API}/api/auth/admin/users`)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || 'Unable to load accounts')
      setAccounts(body as Account[])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return accounts
    return accounts.filter(a => `${a.name} ${a.username} ${a.role}`.toLowerCase().includes(term))
  }, [accounts, search])

  const dateLabel = (timestamp: number | null) => timestamp
    ? new Date(timestamp * 1000).toLocaleDateString()
    : '—'

  const openAdd = () => { setForm(emptyForm); setEditing(null); setFormError(''); setNotice(''); setShowForm(true) }
  const openEdit = (a: Account) => {
    setForm({ username: a.username, name: a.name, password: '', role: a.role === 'admin' ? 'admin' : 'user' })
    setEditing(a.username); setFormError(''); setNotice(''); setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditing(null); setFormError('') }

  const save = async () => {
    setFormError('')
    if (!form.name.trim()) { setFormError('Please enter the full name.'); return }
    if (!editing && !form.username.trim()) { setFormError('Please enter a username or email.'); return }
    if (!editing && form.password.length < 8) { setFormError('Password must be at least 8 characters.'); return }
    if (editing && form.password && form.password.length < 8) { setFormError('New password must be at least 8 characters.'); return }

    setBusy(true)
    try {
      const body = editing
        ? { name: form.name.trim(), role: form.role, password: form.password || null }
        : { username: form.username.trim(), name: form.name.trim(), password: form.password, role: form.role }
      const response = await authFetch(
        `${API}/api/auth/admin/users${editing ? `/${encodeURIComponent(editing)}` : ''}`,
        { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      )
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof json.detail === 'string' ? json.detail : 'Could not save the account.')
      setNotice(editing ? `Updated ${editing}.` : `Created account ${json.username}.`)
      closeForm()
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the account.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Account) => {
    if (!window.confirm(`Delete the account "${a.username}"? This cannot be undone.`)) return
    setNotice(''); setError('')
    try {
      const response = await authFetch(`${API}/api/auth/admin/users/${encodeURIComponent(a.username)}`, { method: 'DELETE' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof json.detail === 'string' ? json.detail : 'Delete failed.')
      setNotice(`Deleted ${a.username}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="m-0 text-sm font-medium text-slate-500">Total accounts</p>
          <p className="mb-0 mt-2 text-3xl font-bold text-slate-900">{accounts.length}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="m-0 text-sm font-medium text-slate-500">Administrator accounts</p>
          <p className="mb-0 mt-2 text-3xl font-bold text-emerald-600">{accounts.filter(a => a.role === 'admin').length}</p>
        </article>
      </section>

      {showForm && (
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <h2 className="m-0 text-lg font-bold text-slate-900">{editing ? `Edit account: ${editing}` : 'Add an account'}</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Full name *
              <input className={fieldClass} value={form.name} maxLength={60} onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Username / Email *
              <input className={fieldClass} value={form.username} disabled={!!editing} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="3-64 characters" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">{editing ? 'New password (leave blank to keep)' : 'Password *'}
              <input className={fieldClass} type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Role
              <select className={fieldClass} value={form.role} disabled={editing === currentUsername} onChange={e => setForm({ ...form, role: e.target.value as Form['role'] })}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
          </div>
          {formError && <p role="alert" className="mb-0 mt-3 text-sm text-red-600">{formError}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button>
            <button type="button" className="secondary" onClick={closeForm}>Cancel</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="m-0 text-lg font-bold text-slate-900">Registered accounts</h2><p className="mb-0 mt-1 text-sm text-slate-500">Add, edit, reset passwords, or delete accounts. Passwords are never displayed.</p></div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-56" />
            {!showForm && <button type="button" onClick={openAdd}>+ Add account</button>}
          </div>
        </div>
        {notice && <p role="status" className="mb-3 mt-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
        {error && !loading && <p role="alert" className="mb-3 mt-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {loading ? <p className="text-sm text-slate-500">Loading accounts...</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-3">Full name</th><th className="px-3 py-3">Username / Email</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Date created</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
              <tbody>{filtered.map(account => {
                const isSelf = account.username === currentUsername
                return (
                  <tr key={account.username} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-3 font-medium text-slate-800">{account.name}{isSelf && <span className="ml-2 text-xs font-semibold text-slate-400">(you)</span>}</td>
                    <td className="px-3 py-3 text-slate-600">{account.username}</td>
                    <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${account.role === 'admin' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{account.role}</span></td>
                    <td className="px-3 py-3 text-slate-600">{dateLabel(account.created)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" className="secondary" onClick={() => openEdit(account)}>Edit</button>
                        <button type="button" className="secondary" disabled={isSelf} title={isSelf ? 'You cannot delete your own account' : undefined} onClick={() => remove(account)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
            {filtered.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No matching accounts found.</p>}
          </div>
        )}
      </section>
    </div>
  )
}