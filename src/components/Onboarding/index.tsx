import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultSttProvider, useAppStore } from '../../stores/appStore'
import { saveOnboardingCompleted, saveOnboardingConfig } from '../../lib/tauri'
import { OnboardingLayout } from './OnboardingLayout'
import { WelcomeStep } from './WelcomeStep'
import { SttSetupStep } from './SttSetupStep'
import { LlmSetupStep } from './LlmSetupStep'
import { PermissionsStep } from './PermissionsStep'
import { QuickTestStep } from './QuickTestStep'
import { DoneStep } from './DoneStep'
import { slideRight } from '../../lib/animations'
import { APPLE_SPEECH_PROVIDER } from '../../lib/constants'

const TOTAL_STEPS = 6

export function Onboarding() {
  const { t } = useTranslation()
  const [saveFailed, setSaveFailed] = useState(false)
  const step = useAppStore((s) => s.onboardingStep)
  const setStep = useAppStore((s) => s.setOnboardingStep)
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted)
  const sttTestStatus = useAppStore((s) => s.sttTestStatus)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const setConfig = useAppStore((s) => s.setConfig)
  const setSavedConfig = useAppStore((s) => s.setSavedConfig)
  const config = useAppStore((s) => s.config)

  const isAppleSpeech = config.stt_provider === APPLE_SPEECH_PROVIDER

  const canNext = (() => {
    switch (step) {
      case 0:
        return true
      case 1:
        // Apple Speech can continue without a successful test so authorization can finish later.
        return sttTestStatus === 'success' || isAppleSpeech
      case 2:
        return true // LLM / polish is optional
      case 3:
      case 4:
      case 5:
        return true
      default:
        return false
    }
  })()

  const titles = [
    { title: t('onboarding.steps.welcome'), subtitle: t('onboarding.steps.welcomeSub') },
    {
      title: t('onboarding.steps.speechRecognition'),
      subtitle: t('onboarding.steps.speechRecognitionSub'),
    },
    { title: t('onboarding.steps.aiPolish'), subtitle: t('onboarding.steps.aiPolishOptionalSub') },
    { title: t('onboarding.steps.permissions'), subtitle: t('onboarding.steps.permissionsSub') },
    { title: t('onboarding.steps.howItWorks'), subtitle: t('onboarding.steps.howItWorksSub') },
    { title: t('onboarding.steps.setupComplete'), subtitle: undefined },
  ]

  const saveConfig = async (draft = config) => {
    setSaveFailed(false)
    try {
      return await saveOnboardingConfig(draft)
    } catch (error) {
      setSaveFailed(true)
      throw error
    }
  }

  const handleNext = async () => {
    if (step === 0) {
      const preferred = defaultSttProvider()
      if (config.stt_provider === 'glm-asr') {
        updateConfig({ stt_provider: preferred, polish_enabled: false })
      } else if (config.polish_enabled && !config.llm_api_key) {
        updateConfig({ polish_enabled: false })
      }
    }

    if (step < TOTAL_STEPS - 1) {
      try {
        await saveConfig(useAppStore.getState().config)
      } catch {
        // Best-effort save — continue navigation even if save fails
      }
      setStep(step + 1)
      return
    }

    try {
      const saved = await saveConfig(useAppStore.getState().config)
      await saveOnboardingCompleted()
      setConfig(saved)
      setSavedConfig(saved)
      setOnboardingCompleted(true)
    } catch {
      setSaveFailed(true)
    }
  }

  const handleBack = async () => {
    if (step > 0) {
      try {
        await saveConfig(config)
      } catch {
        // Best-effort save
      }
      setStep(step - 1)
    }
  }

  const handleSkip = async () => {
    if (step === 2) {
      updateConfig({ polish_enabled: false })
      try {
        await saveConfig({ ...config, polish_enabled: false })
      } catch {
        // Best-effort save
      }
      setStep(3)
      return
    }

    try {
      const saved = await saveConfig({ ...config, polish_enabled: config.polish_enabled })
      await saveOnboardingCompleted()
      setConfig(saved)
      setSavedConfig(saved)
    } catch {
      setSaveFailed(true)
      return
    }
    setOnboardingCompleted(true)
  }

  return (
    <OnboardingLayout
      step={step}
      totalSteps={TOTAL_STEPS}
      title={titles[step].title}
      subtitle={titles[step].subtitle}
      canNext={canNext}
      canBack={step > 0}
      nextLabel={
        step === TOTAL_STEPS - 1 ? t('onboarding.steps.getStarted') : t('onboarding.layout.next')
      }
      onNext={handleNext}
      onBack={handleBack}
      onSkip={handleSkip}
    >
      {saveFailed && (
        <p role="alert" className="mb-3 text-sm text-error">
          {t('common.saveFailed')}
        </p>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={slideRight}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.2 }}
        >
          {step === 0 && <WelcomeStep />}
          {step === 1 && <SttSetupStep />}
          {step === 2 && <LlmSetupStep />}
          {step === 3 && <PermissionsStep />}
          {step === 4 && <QuickTestStep />}
          {step === 5 && <DoneStep />}
        </motion.div>
      </AnimatePresence>
    </OnboardingLayout>
  )
}
