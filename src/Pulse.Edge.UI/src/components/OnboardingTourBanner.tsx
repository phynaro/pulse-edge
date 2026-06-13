import { useState } from 'react';
import { CheckCircle2, Circle, ArrowRight, Sparkles, X } from 'lucide-react';
import type { DriverAdapter, DataPoint } from '../types';
import './OnboardingTourBanner.css';

interface OnboardingTourBannerProps {
  adapters: DriverAdapter[];
  datapoints: DataPoint[];
  setActiveTab: (tab: any) => void;
}

export default function OnboardingTourBanner({
  adapters,
  datapoints,
  setActiveTab
}: OnboardingTourBannerProps) {
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    return localStorage.getItem('pulse_onboarding_tour_dismissed') === 'true';
  });

  // Calculate steps status
  const step1Completed = adapters.length > 0;
  const step2Completed = datapoints.length > 0;
  const step3Completed = datapoints.some(dp => dp.dataSourceId && dp.dataSourceId.trim() !== '');

  const allCompleted = step1Completed && step2Completed && step3Completed;

  // Determine current active step
  let currentStep = 1;
  if (step1Completed) {
    currentStep = 2;
  }
  if (step1Completed && step2Completed) {
    currentStep = 3;
  }
  if (allCompleted) {
    currentStep = 4;
  }

  // If dismissed, don't show
  if (isDismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem('pulse_onboarding_tour_dismissed', 'true');
    setIsDismissed(true);
  };

  return (
    <div className={`onboarding-tour-banner ${allCompleted ? 'tour-completed' : ''}`}>
      <div className="tour-content-row">
        {/* Left Section: Icon & Title */}
        <div className="tour-brand-section">
          <Sparkles className="tour-spark-icon" size={14} />
          <span className="tour-title-mini">
            {allCompleted ? 'Setup Ready!' : `Onboarding (${currentStep}/3)`}
          </span>
        </div>

        {/* Middle Section: Progress Steps */}
        <div className="tour-steps-row">
          {/* Step 1 */}
          <div 
            className={`tour-step-item ${step1Completed ? 'completed' : currentStep === 1 ? 'active' : 'incomplete'}`}
            onClick={() => setActiveTab('protocols')}
          >
            {step1Completed ? (
              <CheckCircle2 className="tour-step-status-icon is-done" size={12} />
            ) : (
              <Circle className="tour-step-status-icon is-todo" size={12} />
            )}
            <span className="tour-step-name">1. Protocol</span>
          </div>

          <div className="tour-step-arrow" />

          {/* Step 2 */}
          <div 
            className={`tour-step-item ${step2Completed ? 'completed' : currentStep === 2 ? 'active' : 'incomplete'}`}
            onClick={() => setActiveTab('tags')}
          >
            {step2Completed ? (
              <CheckCircle2 className="tour-step-status-icon is-done" size={12} />
            ) : (
              <Circle className="tour-step-status-icon is-todo" size={12} />
            )}
            <span className="tour-step-name">2. Register Tag</span>
          </div>

          <div className="tour-step-arrow" />

          {/* Step 3 */}
          <div 
            className={`tour-step-item ${step3Completed ? 'completed' : currentStep === 3 ? 'active' : 'incomplete'}`}
            onClick={() => setActiveTab('datasources')}
          >
            {step3Completed ? (
              <CheckCircle2 className="tour-step-status-icon is-done" size={12} />
            ) : (
              <Circle className="tour-step-status-icon is-todo" size={12} />
            )}
            <span className="tour-step-name">3. Map Stream</span>
          </div>
        </div>

        {/* Right Section: Actions & Close */}
        <div className="tour-actions-section">
          {currentStep === 1 && (
            <button onClick={() => setActiveTab('protocols')} className="tour-action-btn-mini">
              Add Adapter <ArrowRight size={10} />
            </button>
          )}
          {currentStep === 2 && (
            <button onClick={() => setActiveTab('tags')} className="tour-action-btn-mini">
              Add Tag <ArrowRight size={10} />
            </button>
          )}
          {currentStep === 3 && (
            <button onClick={() => setActiveTab('datasources')} className="tour-action-btn-mini">
              Map Stream <ArrowRight size={10} />
            </button>
          )}
          {allCompleted && (
            <button onClick={handleDismiss} className="tour-action-btn-mini success">
              Dismiss
            </button>
          )}
          <button 
            onClick={handleDismiss} 
            className="tour-close-btn-mini" 
            title="Dismiss Tour"
            aria-label="Dismiss tour"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
