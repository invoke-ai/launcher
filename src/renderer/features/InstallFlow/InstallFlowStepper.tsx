import {
  Icon,
  Step,
  StepIcon,
  StepIndicator,
  StepNumber,
  Stepper,
  StepSeparator,
  StepStatus,
  StepTitle,
} from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { PiExclamationMarkBold } from 'react-icons/pi';

import { $installProcessStatus, installFlowApi } from '@/renderer/features/InstallFlow/state';

export const InstallFlowStepper = memo(() => {
  const { t } = useTranslation();
  const activeStep = useStore(installFlowApi.$activeStep);
  const isFinished = useStore(installFlowApi.$isFinished);
  const installProcessStatus = useStore($installProcessStatus);

  return (
    <Stepper w="full" index={activeStep} colorScheme="base" px={0.5}>
      {installFlowApi.steps.map((step, index) => {
        let complete = <StepIcon />;
        if (step === 'Install' && isFinished && installProcessStatus.type !== 'completed') {
          complete = <Icon as={PiExclamationMarkBold} />;
        }
        return (
          <Step key={index} userSelect="none">
            <StepIndicator borderRadius="base">
              <StepStatus complete={complete} incomplete={<StepNumber />} active={<StepNumber />} />
            </StepIndicator>
            <StepTitle color={activeStep >= index ? undefined : 'base.300'}>{t('installFlow.steps.' + step.toLowerCase())}</StepTitle>
            <StepSeparator />
          </Step>
        );
      })}
    </Stepper>
  );
});
InstallFlowStepper.displayName = 'InstallFlowStepper';
