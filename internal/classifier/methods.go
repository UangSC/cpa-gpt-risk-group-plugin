package classifier

import (
	"fmt"

	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/fingerprint"
)

const (
	defaultCandyMissingReason       = "未取得有效回答"
	defaultFingerprintMissingReason = "尚未取得三次有效数字回答，不能计算模型指纹概率"
)

type inspectionMethodSpec struct {
	id                          string
	defaultReasonCode           string
	missingReason               string
	countsTransientServiceError bool
	initRound                   func(round *Round, settings Settings)
	challenges                  func() ([]fingerprint.Challenge, string)
	runningNote                 func(challengeIndex int) *string
	formatHTTPReason            func(codeText string, validSamples int, pureHTTP bool) string
	formatNetworkReason         func(networkErrors int, validSamples int) string
}

var methodSpecs = map[string]inspectionMethodSpec{
	"candy": {
		id:                          "candy",
		defaultReasonCode:           "no-model-response",
		missingReason:               defaultCandyMissingReason,
		countsTransientServiceError: true,
		challenges: func() ([]fingerprint.Challenge, string) {
			return []fingerprint.Challenge{{ID: "candy-bag-21", Question: CandyQuestion, Instructions: cpa.DefaultProbeInstructions}}, ""
		},
		runningNote: func(int) *string { return nil },
		formatHTTPReason: func(codeText string, _ int, pureHTTP bool) string {
			if pureHTTP {
				return fmt.Sprintf("请求返回错误码 %s，未取得有效回答", codeText)
			}
			return fmt.Sprintf("请求异常（含错误码 %s），未取得有效回答", codeText)
		},
		formatNetworkReason: func(networkErrors int, _ int) string {
			return fmt.Sprintf("网络连接异常（×%d），未取得有效回答", networkErrors)
		},
	},
	"fingerprint": {
		id:                          "fingerprint",
		defaultReasonCode:           "fingerprint-insufficient",
		missingReason:               defaultFingerprintMissingReason,
		countsTransientServiceError: true,
		initRound: func(round *Round, settings Settings) {
			round.Evidence.Fingerprint = &Fingerprint{
				ChallengeCount: fingerprint.ChallengeCount,
				Consistency:    "insufficient",
				Samples:        []FingerprintSample{},
				Threshold:      settings.fingerprintThreshold(),
				Candidates:     []fingerprint.Candidate{},
				ReferenceBank:  fingerprint.ReferenceInfo(),
				Decision:       "partial",
			}
		},
		challenges: func() ([]fingerprint.Challenge, string) {
			list := fingerprint.Challenges()
			if len(list) != fingerprint.ChallengeCount {
				return nil, "模型指纹参考库不可用，未发起检测"
			}
			return list, ""
		},
		runningNote: func(challengeIndex int) *string {
			return str(fmt.Sprintf("模型指纹第 %d/%d 次采样", challengeIndex+1, fingerprint.ChallengeCount))
		},
		formatHTTPReason: func(codeText string, validSamples int, pureHTTP bool) string {
			if pureHTTP {
				if validSamples == 0 {
					return fmt.Sprintf("请求返回错误码 %s，未取得有效样本（0/%d）", codeText, fingerprint.ChallengeCount)
				}
				return fmt.Sprintf("请求返回错误码 %s，模型指纹样本不足（%d/%d）", codeText, validSamples, fingerprint.ChallengeCount)
			}
			return fmt.Sprintf("请求异常（含错误码 %s），模型指纹样本不足（%d/%d）", codeText, validSamples, fingerprint.ChallengeCount)
		},
		formatNetworkReason: func(_ int, validSamples int) string {
			return fmt.Sprintf("网络连接异常，模型指纹样本不足（%d/%d）", validSamples, fingerprint.ChallengeCount)
		},
	},
	"pelican": {
		id:                          "pelican",
		defaultReasonCode:           "no-model-response",
		missingReason:               defaultPelicanMissingReason,
		countsTransientServiceError: false,
		challenges: func() ([]fingerprint.Challenge, string) {
			return []fingerprint.Challenge{{ID: pelicanPromptID, Question: PelicanQuestion, Instructions: cpa.DefaultProbeInstructions}}, ""
		},
		runningNote: func(int) *string {
			return str("正在请求模型创建鹈鹕骑车 HTML 动画")
		},
		formatHTTPReason: func(codeText string, _ int, pureHTTP bool) string {
			if pureHTTP {
				return fmt.Sprintf("请求返回错误码 %s，未取得有效鹈鹕动画", codeText)
			}
			return fmt.Sprintf("请求异常（含错误码 %s），未取得有效鹈鹕动画", codeText)
		},
		formatNetworkReason: func(networkErrors int, _ int) string {
			return fmt.Sprintf("网络连接异常（×%d），未取得有效鹈鹕动画", networkErrors)
		},
	},
}

func resolveMethodSpec(method string) inspectionMethodSpec {
	if spec, ok := methodSpecs[method]; ok {
		return spec
	}
	return methodSpecs["candy"]
}
