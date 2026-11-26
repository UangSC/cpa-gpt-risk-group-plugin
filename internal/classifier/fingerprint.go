package classifier

import (
	"fmt"
	"math"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/fingerprint"
)

const defaultFingerprintThresholdPercent = 90.0

func (s Settings) fingerprintThreshold() float64 {
	if s.FingerprintThresholdPercent == nil {
		return defaultFingerprintThresholdPercent / 100
	}
	return *s.FingerprintThresholdPercent / 100
}

func fingerprintThresholdLabel(threshold float64) string {
	return fmt.Sprintf("%g%%", math.Round(threshold*10000)/100)
}

func applyFingerprintResult(round *Round, result fingerprint.Result, retried bool) {
	evidence := round.Evidence.Fingerprint
	evidence.ValidSamples = result.ValidSamples
	evidence.EnrolledAs = result.EnrolledAs
	evidence.Probability, evidence.RequestedProbability = result.Probability, result.RequestedProbability
	evidence.ReferenceMatched, evidence.Decision = result.ReferenceMatched, result.Decision
	evidence.Candidates, evidence.Sequence, evidence.ReferenceBank = result.Candidates, result.Sequence, result.ReferenceBank
	evidence.Mean = &result.Mean
	if result.ClosestModel != "" {
		evidence.ClosestModel = str(result.ClosestModel)
	}
	if result.ClosestFamily != "" {
		evidence.ClosestFamily = str(result.ClosestFamily)
	}
	if result.ValidSamples != fingerprint.ChallengeCount || result.EnrolledAs == "" || result.RequestedProbability == nil {
		evidence.Consistency = "insufficient"
		round.Outcome, round.ReasonCode = "uncertain", "fingerprint-insufficient"
		round.Reason = fmt.Sprintf("模型指纹样本不足（%d/%d）", result.ValidSamples, fingerprint.ChallengeCount)
		return
	}
	probability := *result.RequestedProbability
	if probability > evidence.Threshold && result.ReferenceMatched {
		evidence.Consistency = "consistent"
		round.Outcome, round.ReasonCode = "normal", "all-tests-passed"
		matchedModel := result.ClosestModel
		if matchedModel == "" {
			matchedModel = result.EnrolledAs
		}
		round.Reason = fmt.Sprintf("模型指纹 %.2f%% 概率匹配 %s", probability*100, matchedModel)
		if retried {
			round.ReasonCode = "passed-after-retry"
		}
		return
	}
	evidence.Consistency = "anomalous"
	round.Outcome, round.ReasonCode = "downshift", "fingerprint-anomaly"
	if result.ClosestModel != "" && result.Probability != nil {
		round.Reason = fmt.Sprintf("模型指纹 %.2f%% 概率匹配 %s", (*result.Probability)*100, result.ClosestModel)
	} else {
		round.Reason = fmt.Sprintf("模型指纹归因 %.2f%%", probability*100)
	}
	if result.ReferenceMatched {
		round.Reason += "（未高于 " + fingerprintThresholdLabel(evidence.Threshold) + "）"
	}
}
