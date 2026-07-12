import { useState, useEffect } from 'react';
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
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import './OnboardingWizard.css';
import { useAuth } from '../context/auth';

interface OnboardingWizardProps {
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    warning: (msg: string) => void;
  };
  onComplete: () => void;
  requireFirstAdmin: boolean;
}

interface PairingDashboard {
  cloudStatus: string;
  device?: {
    organizationName?: string;
    siteName?: string;
    cloudEndpoint?: string;
    pairingShortCode?: string;
    pairingBaseUrl?: string;
    pairingExpiresAt?: string;
    pairingToken?: string;
    deviceId?: string;
  };
}

export default function OnboardingWizard({ toast, onComplete, requireFirstAdmin }: OnboardingWizardProps) {
  const { createFirstAdmin } = useAuth();
  const [step, setStep] = useState<number>(0);
  const [serialNumber, setSerialNumber] = useState<string>('');
  const [cloudEndpoint, setCloudEndpoint] = useState<string>('http://localhost:3000');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isValidatingCloud, setIsValidatingCloud] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<boolean>(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(true);
  const [pairingData, setPairingData] = useState<PairingDashboard | null>(null);
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [adminError, setAdminError] = useState('');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settingsRes = await fetch('/api/settings');
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          if (settings.serialNumber) {
            setSerialNumber(settings.serialNumber);
            setCloudEndpoint(settings.cloudEndpoint);

            const hasApiKey = settings.apiKey && settings.apiKey !== 'None';
            if (!hasApiKey) {
              setStep(4); // Skip directly to pairing phase
            }
          }
        }
      } catch (err) {
        console.error('Failed to load settings in wizard:', err);
      } finally {
        setIsLoadingSettings(false);
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (step !== 4) return;

    let isMounted = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/dashboard');
        if (res.ok && isMounted) {
          const data = await res.json();
          setPairingData(data);
        }
      } catch (err) {
        console.error('Error polling dashboard status:', err);
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [step]);

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
        toast.success('PULSE Edge settings saved. Beginning cloud pairing flow...');
        setStep(4);
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

  if (isLoadingSettings) {
    return (
      <div className="onboarding-container">
        <div className="onboarding-glow-1" />
        <div className="onboarding-glow-2" />
        <div className="onboarding-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          <RefreshCw size={32} className="spin" style={{ color: '#0052cc' }} />
          <p style={{ marginTop: '20px', fontSize: '1.1rem', opacity: 0.8 }}>Loading setup configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-container">
      {/* Decorative Blur Spheres for Premium Aero Aesthetic */}
      <div className="onboarding-glow-1" />
      <div className="onboarding-glow-2" />

      {/* Main Aero Card */}
      <div className={`onboarding-card${step === 4 ? ' wide' : ''}`}>

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
              { num: 3, label: 'Verify', icon: Check },
              { num: 4, label: 'Pairing', icon: Globe }
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
                  <><RefreshCw size={16} className="spin" /> Saving settings...</>
                ) : (
                  <>
                    Confirm & Onboard <CheckCircle2 size={16} />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 4: Pairing Status & Direct Handoff Link */}
        {step === 4 && (
          <div className="onboarding-step-content">
            <div>
              <h2 className="onboarding-step-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={20} className="spin" style={{ color: '#0052cc' }} />
                Cloud Device Pairing
              </h2>
              <p className="onboarding-step-desc">
                Your Edge device settings are active. To complete onboarding, pair this physical hardware to your PULSE Cloud enterprise site.
              </p>
            </div>

            {pairingData ? (
              <div style={{ marginTop: '20px' }}>
                {pairingData.cloudStatus === 'Connected' ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: 'rgba(0, 168, 120, 0.1)',
                      color: '#00a878',
                      marginBottom: '16px'
                    }}>
                      <CheckCircle2 size={40} />
                    </div>
                    <h3 style={{ fontSize: '1.4rem', fontWeight: 'bold', margin: '0 0 8px 0' }}>Pairing Successful!</h3>
                    <p style={{ opacity: 0.8, fontSize: '0.95rem', margin: '0 0 24px 0' }}>
                      Linked to: <strong>{pairingData.device?.organizationName || 'N/A'}</strong> / <strong>{pairingData.device?.siteName || 'N/A'}</strong>
                    </p>
                    {requireFirstAdmin ? (
                      <form className="first-admin-form" onSubmit={async e => {
                        e.preventDefault();
                        if (adminPassword !== confirmPassword) { setAdminError('Passwords do not match.'); return; }
                        setIsSubmitting(true); setAdminError('');
                        const error = await createFirstAdmin(adminUsername, adminPassword);
                        setIsSubmitting(false);
                        if (error) setAdminError(error); else onComplete();
                      }}>
                        <div className="first-admin-heading"><ShieldCheck size={18} /><div><strong>Create the local administrator</strong><span>This account controls configuration and future users.</span></div></div>
                        <input className="form-input" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} placeholder="Administrator username" autoComplete="username" required />
                        <div className="first-admin-passwords">
                          <input className="form-input" type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Password" autoComplete="new-password" required />
                          <input className="form-input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" autoComplete="new-password" required />
                        </div>
                        <small className="onboarding-input-tip">10+ characters with upper-case, lower-case, number, and special character.</small>
                        {adminError && <div className="auth-error">{adminError}</div>}
                        <button disabled={isSubmitting} className="onboarding-btn onboarding-btn-primary" style={{ width: '100%' }}>{isSubmitting ? 'Securing node…' : <>Create Admin & Enter Dashboard <ArrowRight size={18} /></>}</button>
                      </form>
                    ) : (
                      <button type="button" onClick={onComplete} className="onboarding-btn onboarding-btn-primary" style={{ width: '100%' }}>
                        Enter Dashboard <ArrowRight size={18} />
                      </button>
                    )}
                  </div>
                ) : pairingData.cloudStatus === 'Revoked' ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: 'rgba(239, 71, 111, 0.1)',
                      color: '#ef476f',
                      marginBottom: '16px'
                    }}>
                      <AlertTriangle size={40} />
                    </div>
                    <h3 style={{ fontSize: '1.4rem', fontWeight: 'bold', margin: '0 0 8px 0' }}>Access Revoked</h3>
                    <p style={{ opacity: 0.8, fontSize: '0.95rem', margin: '0 0 24px 0' }}>
                      This device registration has been revoked by the Cloud administrator. Please contact your system administrator.
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="onboarding-btn onboarding-btn-action-back"
                      style={{ width: '100%' }}
                    >
                      Re-configure settings
                    </button>
                  </div>
                ) : (
                  <div className="onboarding-split-layout">
                    {/* Left Column: Status, Direct Link, and Shortcode */}
                    <div className="onboarding-split-left">
                      {!pairingData.device?.pairingShortCode ? (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          background: 'rgba(255,179,0,0.05)',
                          padding: '16px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,179,0,0.2)',
                          marginBottom: '16px'
                        }}>
                          <RefreshCw size={20} className="spin" style={{ color: '#ffb300', flexShrink: 0 }} />
                          <span style={{ fontSize: '0.9rem', opacity: 0.85 }}>
                            Connecting to Cloud and registering device... If this message persists, please check that the <strong>PULSE Edge Agent</strong> service is running and can reach the Cloud target (<code>{pairingData.device?.cloudEndpoint}</code>).
                          </span>
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          background: 'rgba(0,168,120,0.05)',
                          padding: '12px 16px',
                          borderRadius: '8px',
                          border: '1px solid rgba(0,168,120,0.1)',
                          marginBottom: '16px'
                        }}>
                          <RefreshCw size={20} className="spin" style={{ color: '#00a878', flexShrink: 0 }} />
                          <span style={{ fontSize: '0.9rem', opacity: 0.8 }}>Waiting for approval from PULSE Cloud operator...</span>
                        </div>
                      )}

                      {pairingData.device?.pairingBaseUrl && (
                        <div style={{ marginBottom: '16px' }}>
                          <p style={{ fontSize: '0.9rem', opacity: 0.7, marginBottom: '10px' }}>
                            If your setup laptop has Cloud internet access, click below to link:
                          </p>
                          <a
                            href={`${pairingData.device.pairingBaseUrl}?deviceId=${pairingData.device.deviceId}&token=${pairingData.device.pairingToken}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="onboarding-btn onboarding-btn-primary"
                            style={{ textDecoration: 'none', display: 'inline-flex', width: '100%', justifyContent: 'center', margin: '0' }}
                          >
                            Link Device in Central Cloud <ArrowRight size={16} />
                          </a>
                        </div>
                      )}

                      {pairingData.device?.pairingShortCode && (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '8px',
                          background: 'rgba(0,82,204,0.03)',
                          padding: '16px',
                          borderRadius: '8px',
                          border: '1px solid rgba(0,82,204,0.1)'
                        }}>
                          <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>Or enter this code on the Cloud pairing page:</span>
                          <div style={{
                            fontSize: '2rem',
                            fontWeight: 'bold',
                            letterSpacing: '3px',
                            color: '#0052cc',
                            textShadow: '0 0 10px rgba(0,82,204,0.2)'
                          }}>
                            {pairingData.device.pairingShortCode}
                          </div>
                          {pairingData.device.pairingExpiresAt && (() => {
                            const expiryStr = pairingData.device.pairingExpiresAt;
                            const dateSpec = expiryStr.endsWith('Z') || expiryStr.includes('+') ? expiryStr : `${expiryStr}Z`;
                            return (
                              <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                                Expires at {new Date(dateSpec).toLocaleTimeString()}
                              </span>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Right Column: QR Code scanning */}
                    <div className="onboarding-split-right">
                      {pairingData.device?.pairingBaseUrl && (() => {
                        const pairingUrl = `${pairingData.device.pairingBaseUrl}?deviceId=${pairingData.device.deviceId}&token=${pairingData.device.pairingToken}`;
                        return (
                          <div className="onboarding-qr-container" style={{ marginTop: '0' }}>
                            <span style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: '12px', display: 'block', textAlign: 'center' }}>
                              Or scan this QR Code with your mobile to link instantly:
                            </span>
                            <div className="onboarding-qr-wrapper">
                              <QRCodeSVG
                                value={pairingUrl}
                                size={160}
                                level="H"
                                includeMargin={false}
                                bgColor="#ffffff"
                                fgColor="#1a202c"
                                imageSettings={{
                                  src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHJ4PSI4IiBmaWxsPSIjMWEyMDJjIi8+PHBhdGggZD0iTTMyIDIwaC02LjRsLTQuOCAxNC40TDE5LjIgNS42bC00LjggMTQuNEg4IiBmaWxsPSJub25lIiBzdHJva2U9IiMzY2U4YmQiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+",
                                  height: 32,
                                  width: 32,
                                  excavate: true,
                                }}
                              />
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                marginTop: '10px',
                                color: '#1a202c',
                                fontWeight: 800,
                                fontSize: '0.8rem',
                                letterSpacing: '0.5px'
                              }}>
                                <span style={{ opacity: 0.6 }}>PULSE</span>
                                <span style={{ color: '#00a878' }}>EDGE</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' }}>
                <RefreshCw size={24} className="spin" style={{ color: '#0052cc' }} />
                <p style={{ marginTop: '10px', fontSize: '0.9rem', opacity: 0.7 }}>Contacting local Edge service status...</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
