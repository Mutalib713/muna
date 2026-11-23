import Overview from './Overview'
import QuestionBank from './QuestionBank'
import AnswerReview from './AnswerReview'
import IntegrityFlags from './IntegrityFlags'
import Assessments from './Assessments'

// One view = one file. To add a dashboard view:
//   1. Create the component in src/dashboard/views/
//   2. Add an entry below (label, icon, Component, optional badge)
// The shell renders the active entry and passes every view the same
// `dashboard` context object (see AdminDashboard.jsx for its shape).
// `badge` values map to nav badge counters in the shell ('answers' |
// 'flags' today; extend there when adding new badge types).
export const dashboardViews = [
  { label: 'Overview', icon: 'grid', Component: Overview },
  { label: 'Question bank', icon: 'book', Component: QuestionBank },
  { label: 'Assessments', icon: 'file', Component: Assessments },
  { label: 'Answer review', icon: 'check', Component: AnswerReview, badge: 'answers' },
  { label: 'Integrity flags', icon: 'shield', Component: IntegrityFlags, badge: 'flags' },
]