import { useState } from 'react'
import { PenTool, FileText, CheckCircle2, HelpCircle } from '../../icons'
import CanvasQuestion from './CanvasQuestion'
import TheoryQuestion from './TheoryQuestion'
import McqQuestion from './McqQuestion'
import ShortAnswerQuestion from './ShortAnswerQuestion'
import TrueFalseQuestion from './TrueFalseQuestion'

export default function QuestionStudio() {
  const [activeTab, setActiveTab] = useState('canvas')

  return (
    <section id="studio" className="showcase-section">
      <div className="content-wrap">
        <div className="section-header">
          <div className="section-badge">Live Interactive Preview</div>
          <h2 className="section-title">The First-Class Question Studio</h2>
          <p className="section-desc">
            Test Muna's core response types below. Every response format is natively rendered, 
            autosaved continuously, and tied to server-side rubrics.
          </p>
        </div>

        <div className="studio-card">
          {/* Studio Navigation Tabs */}
          <div className="studio-tabs">
            <button
              type="button"
              className={`studio-tab ${activeTab === 'canvas' ? 'active' : ''}`}
              onClick={() => setActiveTab('canvas')}
            >
              <PenTool size={16} /> Freehand Drawing
            </button>
            <button
              type="button"
              className={`studio-tab ${activeTab === 'theory' ? 'active' : ''}`}
              onClick={() => setActiveTab('theory')}
            >
              <FileText size={16} /> Theory & Rubric
            </button>
            <button
              type="button"
              className={`studio-tab ${activeTab === 'mcq' ? 'active' : ''}`}
              onClick={() => setActiveTab('mcq')}
            >
              <CheckCircle2 size={16} /> Multi-Select & MCQ
            </button>
            <button
              type="button"
              className={`studio-tab ${activeTab === 'short' ? 'active' : ''}`}
              onClick={() => setActiveTab('short')}
            >
              <HelpCircle size={16} /> Short Answer
            </button>
            <button
              type="button"
              className={`studio-tab ${activeTab === 'tf' ? 'active' : ''}`}
              onClick={() => setActiveTab('tf')}
            >
              <CheckCircle2 size={16} /> True / False
            </button>
          </div>

          {/* Studio Tab Content */}
          <div className="studio-panel">
            {activeTab === 'canvas' && <CanvasQuestion />}
            {activeTab === 'theory' && <TheoryQuestion />}
            {activeTab === 'mcq' && <McqQuestion />}
            {activeTab === 'short' && <ShortAnswerQuestion />}
            {activeTab === 'tf' && <TrueFalseQuestion />}
          </div>
        </div>
      </div>
    </section>
  )
}
