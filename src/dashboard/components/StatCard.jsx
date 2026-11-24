import Icon from '../DashboardIcon'

export default function StatCard({ label, value, change, icon, tone, caption }) {
  return <section className="panel stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon} size={19} /></div><p className="stat-label">{label}</p><div className="stat-value">{value}</div><div className="stat-foot"><span className={tone === 'blue' ? 'positive-change' : 'stat-description'}>{change}</span>{caption && <span className="stat-description">{caption}</span>}</div><span className="stat-trend"><Icon name="arrow" size={15} /></span></section>
}