import { useState } from 'react';
import { 
  Cpu, 
  Cloud, 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  Activity, 
  Sparkles, 
  Globe, 
  CheckCircle2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import './OnboardingWizard.css';

interface OnboardingWizardProps {
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    warning: (msg: string) => void;
  };
  onComplete: () => void;
}

export default function OnboardingWizard({ toast, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<number>(0);
  const [serialNumber, setSerialNumber] = useState<string>('');
  const [cloudEndpoint, setCloudEndpoint] = useState<string>('http://localhost:3000');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isValidatingCloud, setIsValidatingCloud] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<boolean>(false);

  // Auto-generate a beautiful random serial number
  const handleGenerateSerial = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setSerialNumber(`PULSE-EDGE-${code}`);
    toast.success('Generated device identifier.');
  };

  const handleValidateCloud = async (skipValidation = false) => {
    if (!cloudEndpoint.trim()) {
      toast.error('Please specify a cloud target URL.');
      return;
    }
    if (!cloudEndpoint.startsWith('http://') && !cloudEndpoint.startsWith('https://')) {
      toast.error('Target URL must start with http:// or https://');
      return;
    }

    if (skipValidation) {
      toast.warning('Skipped cloud endpoint validation.');
      setStep(3);
      return;
    }

    setIsValidatingCloud(true);
    setValidationError(null);
    setValidationSuccess(false);

    try {
      const res = await fetch('/api/settings/validate-cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          cloudEndpoint: cloudEndpoint.trim(),
          serialNumber: serialNumber.trim()
        })
      });

      if (res.ok) {
        setValidationSuccess(true);
        toast.success('Successfully connected to PULSE Cloud endpoint!');
        setTimeout(() => {
          setStep(3);
          setValidationSuccess(false);
        }, 1000);
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || 'Failed to communicate with cloud synchronizer endpoint.';
        setValidationError(errMsg);
        toast.error(errMsg);
      }
    } catch (err) {
      console.error('Cloud validation failed:', err);
      const errMsg = 'A network error occurred while validating the cloud endpoint.';
      setValidationError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsValidatingCloud(false);
    }
  };

  const handleNext = () => {
    if (step === 1 && !serialNumber.trim()) {
      toast.error('Please specify a device serial number to continue.');
      return;
    }
    if (step === 2) {
      handleValidateCloud(false);
      return;
    }
    setStep(prev => prev + 1);
  };

  const handleBack = () => {
    setStep(prev => prev - 1);
  };

  const handleInitialize = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialNumber: serialNumber.trim(),
          cloudEndpoint: cloudEndpoint.trim()
        })
      });

      if (res.ok) {
        toast.success('PULSE Edge node initialized successfully!');
        onComplete();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to initialize system settings.');
      }
    } catch (err) {
      console.error('Failed to initialize settings:', err);
      toast.error('An error occurred while saving onboarding settings.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="onboarding-container">
      {/* Decorative Blur Spheres for Premium Aero Aesthetic */}
      <div className="onboarding-glow-1" />
      <div className="onboarding-glow-2" />

      {/* Main Aero Card */}
      <div className="onboarding-card">
        
        {/* Onboarding Wizard Header */}
        <div className="onboarding-header">
          <div className="onboarding-brand">
            <Activity className="onboarding-brand-icon" size={24} />
            <span>
              PULSE <span className="onboarding-brand-accent">EDGE</span>
            </span>
          </div>
          <span className="badge primary onboarding-badge">
            SETUP WIZARD
          </span>
        </div>

        {/* Stepper Progress */}
        {step > 0 && (
          <div className="onboarding-stepper">
            {[
              { num: 1, label: 'Identity', icon: Cpu },
              { num: 2, label: 'Cloud Sync', icon: Cloud },
              { num: 3, label: 'Verify', icon: Check }
            ].map(s => {
              const Icon = s.icon;
              const isActive = step === s.num;
              const isCompleted = step > s.num;
              return (
                <div 
                  key={s.num} 
                  className={`onboarding-step${isActive ? ' active' : ''}${isCompleted ? ' completed' : ''}`}
                >
                  <div className="onboarding-step-circle">
                    {isCompleted ? <Check size={12} strokeWidth={3} /> : s.num}
                  </div>
                  <span className="onboarding-step-label">
                    <Icon size={12} />
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Step 0: Welcome Screen */}
        {step === 0 && (
          <div className="onboarding-step-content">
            <h1 className="onboarding-welcome-title">
              Initialize Your IoT Edge Node
            </h1>
            <p className="onboarding-subtitle">
              Welcome to the PULSE Edge dashboard! This portal enables local protocol synchronization and connects your node with the central monitoring orchestrator.
            </p>
            <div className="onboarding-info-box">
              <Sparkles className="onboarding-info-icon" size={18} />
              <span>Feel the PULSE! Experience the magic of a supercharged setup that connects your local metrics to the cloud in record time, keeping your device health at 100%.</span>
            </div>
            <button 
              type="button"
              onClick={() => setStep(1)}
              className="onboarding-btn onboarding-btn-primary"
            >
              Get Started <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* Step 1: Device Identification */}
        {step === 1 && (
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleNext();
            }}
            className="onboarding-step-content"
          >
            <div>
              <h2 className="onboarding-step-title">Assign Device Identifier</h2>
              <p className="onboarding-step-desc">
                Every edge device must have a unique hardware identifier or serial number. This distinguishes its metric streams in the cloud.
              </p>
            </div>
            
            <div className="form-group">
              <label htmlFor="serialNumber" className="form-label">Device Serial Number / Name</label>
              <div className="onboarding-form-input-group">
                <input 
                  type="text" 
                  id="serialNumber"
                  name="serialNumber"
                  className="form-input" 
                  placeholder="e.g. PULSE-EDGE-001" 
                  value={serialNumber} 
                  onChange={e => setSerialNumber(e.target.value)}
                  required
                />
                <button 
                  type="button"
                  onClick={handleGenerateSerial}
                  className="onboarding-btn-inline-secondary"
                >
                  Generate ID
                </button>
              </div>
              <small className="onboarding-input-tip">
                Tip: You can use any unique string representing this specific node placement.
              </small>
            </div>

            <div className="onboarding-button-row">
              <button 
                type="button"
                onClick={handleBack}
                className="onboarding-btn onboarding-btn-action-back"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button 
                type="submit"
                className="onboarding-btn onboarding-btn-action-next"
              >
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Cloud Sync Configuration */}
        {step === 2 && (
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleNext();
            }}
            className="onboarding-step-content"
          >
            <div>
              <h2 className="onboarding-step-title">Cloud Connector Target</h2>
              <p className="onboarding-step-desc">
                Specify the target PULSE Cloud or internal datacenter orchestrator URL where metric packages will be synced.
              </p>
            </div>
            
            <div className="form-group">
              <label htmlFor="cloudEndpoint" className="form-label">Target URL Endpoint</label>
              <div className="onboarding-url-input-wrapper">
                <input 
                  type="url" 
                  id="cloudEndpoint"
                  name="cloudEndpoint"
                  className="form-input" 
                  placeholder="e.g. https://cloud.pulse-iot.net" 
                  value={cloudEndpoint} 
                  onChange={e => {
                    setCloudEndpoint(e.target.value);
                    setValidationError(null);
                  }}
                  disabled={isValidatingCloud}
                  required
                />
                <Globe size={16} className="onboarding-url-icon" />
              </div>
              <small className="onboarding-input-tip">
                Default local dashboard testing uses <code>http://localhost:3000</code>.
              </small>
            </div>

            {validationError && (
              <div className="onboarding-error-box">
                <AlertTriangle size={16} className="onboarding-error-icon" />
                <div className="onboarding-error-details">
                  <span className="onboarding-error-text">{validationError}</span>
                  <button
                    type="button"
                    onClick={() => handleValidateCloud(true)}
                    className="onboarding-btn-skip"
                  >
                    Skip Verification & Proceed
                  </button>
                </div>
              </div>
            )}

            {validationSuccess && (
              <div className="onboarding-success-box">
                <Check size={16} className="onboarding-success-icon" />
                <span className="onboarding-success-text">Verification successful! Connection established.</span>
              </div>
            )}

            <div className="onboarding-button-row">
              <button 
                type="button"
                onClick={handleBack}
                disabled={isValidatingCloud}
                className="onboarding-btn onboarding-btn-action-back"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button 
                type="submit"
                disabled={isValidatingCloud || validationSuccess}
                className={`onboarding-btn onboarding-btn-action-next${validationSuccess ? ' success' : ''}`}
              >
                {isValidatingCloud ? (
                  <>
                    <RefreshCw size={16} className="spin" /> Verifying Connection...
                  </>
                ) : validationSuccess ? (
                  <>
                    Success! <Check size={16} />
                  </>
                ) : (
                  <>
                    Verify & Continue <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Summary & Activation */}
        {step === 3 && (
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleInitialize();
            }}
            className="onboarding-step-content"
          >
            <div>
              <h2 className="onboarding-step-title">Review Configuration</h2>
              <p className="onboarding-step-desc">
                Confirm the details below before activating this Edge node.
              </p>
            </div>
            
            <div className="onboarding-summary-box">
              <div className="onboarding-summary-row">
                <span className="onboarding-summary-label">Serial Identifier:</span>
                <span className="onboarding-summary-value">{serialNumber}</span>
              </div>
              <div className="onboarding-summary-row">
                <span className="onboarding-summary-label">Cloud Synchronizer Target:</span>
                <span className="onboarding-summary-value">{cloudEndpoint}</span>
              </div>
              <div className="onboarding-summary-row">
                <span className="onboarding-summary-label">Security Link:</span>
                <span className="onboarding-summary-value warning">
                  ⚠ Pending Cloud Approval
                </span>
              </div>
            </div>

            <div className="onboarding-button-row">
              <button 
                type="button"
                onClick={handleBack}
                disabled={isSubmitting}
                className="onboarding-btn onboarding-btn-action-back"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button 
                type="submit"
                disabled={isSubmitting}
                className="onboarding-btn onboarding-btn-launch"
              >
                {isSubmitting ? (
                  <>Initializing Node...</>
                ) : (
                  <>
                    Initialize & Launch <CheckCircle2 size={16} />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
