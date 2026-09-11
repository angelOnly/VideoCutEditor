import { Composition } from 'remotion';
import { FINANCIAL_DIALOGUE_DURATION_FRAMES, FinancialReportDialogue } from './FinancialReportDialogue';
import { FINANCIAL_DIALOGUE_V3_DURATION_FRAMES, FinancialReportDialogueV3 } from './FinancialReportDialogueV3';
import { FINANCIAL_INTRO_DURATION_FRAMES, FINANCIAL_INTRO_SFX_DURATION_FRAMES, FINANCIAL_LOGO_ALPHA_DURATION_FRAMES, FinancialIntroDataRush, FinancialIntroDolly, FinancialIntroPortraitSfx, FinancialIntroSplitReveal, FinancialIntroTypography, FinancialIntroTypographySfx, FinancialLogoAlpha } from './FinancialIntros';
import { FINANCE_DURATION_FRAMES, FinancialReportPreview } from './FinancialReportPreview';
import { FINANCIAL_VERTICAL_DURATION_FRAMES, FinancialReportVertical } from './FinancialReportVertical';
import { RESCUE_INTERCUT_DURATION_FRAMES, RescueNewsIntercut } from './RescueNewsIntercut';
import { SprintReview } from './SprintReview';
import { videoConfig } from './config/sprint-config';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SprintReview"
        component={SprintReview}
        durationInFrames={videoConfig.fps * videoConfig.durationSeconds}
        fps={videoConfig.fps}
        width={videoConfig.width}
        height={videoConfig.height}
      />
      <Composition
        id="FinancialReportPreview"
        component={FinancialReportPreview}
        durationInFrames={FINANCE_DURATION_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="FinancialReportDialogue"
        component={FinancialReportDialogue}
        durationInFrames={FINANCIAL_DIALOGUE_DURATION_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition id="FinancialReportDialogueV3" component={FinancialReportDialogueV3} durationInFrames={FINANCIAL_DIALOGUE_V3_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialReportVertical" component={FinancialReportVertical} durationInFrames={FINANCIAL_VERTICAL_DURATION_FRAMES} fps={30} width={1080} height={1920} />
      <Composition id="RescueNewsIntercut" component={RescueNewsIntercut} durationInFrames={RESCUE_INTERCUT_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialIntroDolly" component={FinancialIntroDolly} durationInFrames={FINANCIAL_INTRO_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialIntroDataRush" component={FinancialIntroDataRush} durationInFrames={FINANCIAL_INTRO_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialIntroSplitReveal" component={FinancialIntroSplitReveal} durationInFrames={FINANCIAL_INTRO_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialIntroTypography" component={FinancialIntroTypography} durationInFrames={FINANCIAL_INTRO_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialIntroTypographySfx" component={FinancialIntroTypographySfx} durationInFrames={FINANCIAL_INTRO_SFX_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialIntroPortraitSfx" component={FinancialIntroPortraitSfx} durationInFrames={FINANCIAL_INTRO_SFX_DURATION_FRAMES} fps={30} width={1920} height={1080} />
      <Composition id="FinancialLogoAlpha" component={FinancialLogoAlpha} durationInFrames={FINANCIAL_LOGO_ALPHA_DURATION_FRAMES} fps={30} width={1920} height={1080} />
    </>
  );
};
