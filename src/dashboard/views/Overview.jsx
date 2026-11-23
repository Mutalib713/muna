import Icon from '../DashboardIcon'
import StatCard from '../components/StatCard'
import AnswerTable from '../components/AnswerTable'

// Receives the `dashboard` context bag from AdminDashboard.jsx.
export default function Overview({ dashboard }) {
  const { questions, answers, pendingAnswers, unresolvedFlags, navigate, openQuestionModal, selectAnswer } = dashboard

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">MONDAY, NOVEMBER 23, 2026</p><h1>Good morning, Alex <span>✦</span></h1><p className="subheading">Here&apos;s what&apos;s happening with your assessments today.</p></div>
        <button className="button button-primary" onClick={() => { navigate('Question bank'); openQuestionModal() }}><Icon name="plus" size={17} /> Create question</button>
      </div>
      <div className="stat-grid">
        <StatCard label="Total students" value="1,248" change="+12.8%" icon="users" tone="blue" caption="vs. last month" />
        <StatCard label="Questions in bank" value={questions.length.toLocaleString()} change="Across 8 topics" icon="book" tone="purple" />
        <StatCard label="Awaiting review" value={pendingAnswers.toString().padStart(2, '0')} change="Needs your attention" icon="clock" tone="amber" />
        <StatCard label="Integrity flags" value={unresolvedFlags.toString().padStart(2, '0')} change="Require careful review" icon="shield" tone="rose" />
      </div>
      <div className="overview-grid">
        <section className="panel activity-panel">
          <div className="panel-heading"><div><h2>Assessment activity</h2><p>Submissions over the past week</p></div><button className="select-button">This week <span>⌄</span></button></div>
          <div className="chart" role="img" aria-label="Bar chart showing assessment activity across the week">
            <div className="chart-grid"><span>200</span><span>150</span><span>100</span><span>50</span><span>0</span></div>
            <div className="chart-bars">{[['Mon', 54], ['Tue', 73], ['Wed', 62], ['Thu', 89], ['Fri', 68], ['Sat', 42], ['Sun', 57]].map(([day, height]) => <div className="chart-column" key={day}><div className="bar-track"><span className="bar" style={{ height: `${height}%` }} /></div><span className="chart-day">{day}</span></div>)}</div>
          </div>
        </section>
        <section className="panel attention-panel">
          <div className="panel-heading"><div><h2>Needs your attention</h2><p>Items waiting for a review</p></div><span className="attention-count">{pendingAnswers + unresolvedFlags}</span></div>
          <button className="attention-item" onClick={() => navigate('Answer review')}><span className="attention-icon amber"><Icon name="file" /></span><span><strong>{pendingAnswers} answers to review</strong><small>Student submissions are waiting</small></span><span className="chevron">›</span></button>
          <button className="attention-item" onClick={() => navigate('Integrity flags')}><span className="attention-icon rose"><Icon name="shield" /></span><span><strong>{unresolvedFlags} integrity signals</strong><small>Review the context before deciding</small></span><span className="chevron">›</span></button>
          <div className="review-note"><Icon name="alert" size={16} /><span>Integrity signals are prompts for review, not proof of misconduct.</span></div>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading"><div><h2>Recent submissions</h2><p>Latest student activity</p></div><button className="text-button" onClick={() => navigate('Answer review')}>View all <span>→</span></button></div>
        <AnswerTable answers={answers.slice(0, 4)} onSelect={selectAnswer} />
      </section>
    </>
  )
}