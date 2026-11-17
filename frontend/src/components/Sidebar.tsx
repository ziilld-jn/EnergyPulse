import { useState, useEffect } from 'react'

interface SidebarProps {
  activePage: string
  onNavigate: (page: string) => void
  userName: string
  userRole: string
  onLogout: () => void
}

const navigation = [
  { icon: 'OV', label: 'Overview' },
  { icon: 'DS', label: 'Dataset Management' },
  { icon: 'EN', label: 'Energy Consumption' },
  { icon: 'FC', label: 'Forecasting' },
  { icon: 'PL', label: 'Peak-Load Analysis' },
  { icon: 'BL', label: 'Buildings' },
  { icon: 'RP', label: 'Reports' },
]

// Admins only manage accounts, so they get no analytics pages.
const adminNavigation = [{ icon: 'AD', label: 'Admin Dashboard' }]

export default function Sidebar({ activePage, onNavigate, userName, userRole, onLogout }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('ep_sidebar_collapsed') === 'true'
  })

  useEffect(() => {
    localStorage.setItem('ep_sidebar_collapsed', String(collapsed))
  }, [collapsed])

  return (
    <aside
      className={`relative flex flex-col bg-[#101B2D] text-white transition-all duration-300 ease-in-out select-none shrink-0 border-r border-slate-800 h-screen sticky top-0 ${
        collapsed ? 'w-20 p-3' : 'w-64 p-5'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        {!collapsed ? (
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-lg font-bold text-white shadow-lg shadow-emerald-500/20">
              ⚡
            </div>
            <div className="truncate">
              <h1 className="text-base font-bold tracking-tight text-white m-0">
                EnergyPulse
              </h1>
              <p className="text-[10px] font-semibold tracking-wider text-teal-400 m-0">
                2.0 ANALYTICS
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-xl font-bold text-white shadow-lg shadow-emerald-500/20" title="EnergyPulse 2.0">
            ⚡
          </div>
        )}

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={`flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white transition-all ${
            collapsed ? 'absolute -right-3 top-6 bg-[#101B2D] shadow-md z-50' : ''
          }`}
          title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          aria-label="Toggle Sidebar"
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {!collapsed && (
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 px-2">
          Main Menu
        </p>
      )}

      {/* Navigation */}
      <nav className="flex flex-col gap-1.5 flex-grow">
        {(userRole === 'admin' ? adminNavigation : navigation).map((item) => {
          const isActive = activePage === item.label
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onNavigate(item.label)}
              title={collapsed ? item.label : undefined}
              className={`relative flex items-center gap-3 w-full rounded-xl px-3.5 py-3 text-left font-medium transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-colors ${
                  isActive
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-white/5 text-slate-300'
                }`}
              >
                {item.icon}
              </span>

              {!collapsed && (
                <span className="text-sm truncate">{item.label}</span>
              )}

              {isActive && !collapsed && (
                <span className="absolute right-3 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="pt-4 border-t border-white/10 mt-auto">
        {/* Signed-in user + log out */}
        {!collapsed ? (
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-sm font-bold text-white">
              {userName.trim().charAt(0).toUpperCase() || '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-xs font-semibold text-slate-100" title={userName}>{userName}</p>
              <button
                type="button"
                onClick={onLogout}
                className="border-0 bg-transparent p-0 text-[11px] font-semibold text-slate-400 hover:text-red-400 transition-colors"
              >
                Log out
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            title={`Log out (${userName})`}
            aria-label="Log out"
            className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[10px] font-bold text-slate-300 hover:bg-red-500/20 hover:text-red-300 transition-colors"
          >
            OUT
          </button>
        )}

        {!collapsed ? (
          <div>
            <p className="text-xs font-semibold text-slate-200 m-0">EnergyPulse</p>
            <p className="text-[10px] text-slate-500 m-0 mt-0.5">Professional Tier</p>
          </div>
        ) : (
          <div className="mx-auto h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" title="Professional Tier Active" />
        )}
      </div>
    </aside>
  )
}