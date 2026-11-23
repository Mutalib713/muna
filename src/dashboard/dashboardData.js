// Demo records keep the dashboard populated until it is connected to a
// data service. Extracted from Priscilla's original App.jsx verbatim.

export const initialQuestions = [
  { id: 'Q-104', prompt: 'Which process converts sunlight into chemical energy?', options: ['Respiration', 'Photosynthesis', 'Fermentation', 'Transpiration'], correctAnswer: 'Photosynthesis', status: 'Published' },
  { id: 'Q-103', prompt: 'What is the value of x in 3x + 5 = 20?', options: ['3', '5', '7', '15'], correctAnswer: '5', status: 'Published' },
  { id: 'Q-102', prompt: 'Which layer of the atmosphere contains the ozone layer?', options: ['Troposphere', 'Stratosphere', 'Mesosphere', 'Thermosphere'], correctAnswer: 'Stratosphere', status: 'Published' },
  { id: 'Q-101', prompt: 'What is the smallest prime number?', options: ['0', '1', '2', '3'], correctAnswer: '2', status: 'Published' },
]

export const initialAnswers = [
  { id: 'A-2381', student: 'Amara Okafor', initials: 'AO', question: 'Photosynthesis and energy', answer: 'Photosynthesis', score: '9 / 10', submitted: 'Today, 10:42 AM', status: 'Needs review' },
  { id: 'A-2380', student: 'Daniel Mensah', initials: 'DM', question: 'Algebra fundamentals', answer: 'x = 5; I subtracted 5 from both sides, then divided by 3.', score: '8 / 10', submitted: 'Today, 10:35 AM', status: 'Needs review' },
  { id: 'A-2379', student: 'Sofia Chen', initials: 'SC', question: 'Photosynthesis and energy', answer: 'Photosynthesis', score: '10 / 10', submitted: 'Today, 10:20 AM', status: 'Reviewed' },
  { id: 'A-2378', student: 'Kwame Boateng', initials: 'KB', question: 'Earth science review', answer: 'The stratosphere contains most of the ozone layer.', score: '7 / 10', submitted: 'Today, 9:58 AM', status: 'Needs review' },
  { id: 'A-2377', student: 'Priya Patel', initials: 'PP', question: 'Algebra fundamentals', answer: '5', score: '10 / 10', submitted: 'Today, 9:41 AM', status: 'Reviewed' },
]

export const initialFlags = [
  { id: 'F-021', student: 'Jordan Lee', initials: 'JL', assessment: 'Algebra fundamentals', signal: 'Unusually similar answer to another submission', detail: 'Submitted 18 seconds apart', level: 'Review' },
  { id: 'F-020', student: 'Fatima Yusuf', initials: 'FY', assessment: 'Earth science review', signal: 'Multiple answers submitted in an unusually short time', detail: '4 answers in 22 seconds', level: 'Review' },
  { id: 'F-019', student: 'Ethan Williams', initials: 'EW', assessment: 'Photosynthesis and energy', signal: 'Repeated page focus changes during assessment', detail: '12 focus changes recorded', level: 'Review' },
]

export const navigation = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Question bank', icon: 'book' },
  { label: 'Answer review', icon: 'check' },
  { label: 'Integrity flags', icon: 'shield' },
]
