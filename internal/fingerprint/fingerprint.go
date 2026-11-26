// Package fingerprint performs calibrated attribution against a frozen model bank.
// The detector and its reference data are adapted from the MIT-licensed
// cpa-plugin-codex-candy-eval and Ikaleio/lm-detector projects. See data/README.md.
package fingerprint

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"strconv"
	"strings"
)

const (
	ChallengeCount    = 3
	maxAnswerBytes    = 64000
	fingerprintTarget = ChallengeCount
	SourceCommit      = "a4ef212df06817e8071acd05f00219f4c9eb2f9a"
	PortCommit        = "86d832c58f85f33e0cff91368fae1cb1012899f8"
)

//go:embed data/enrollment-suite.json
var enrollmentSuiteJSON []byte

type Challenge struct {
	ID            string `json:"id"`
	Instructions  string `json:"instructions,omitempty"`
	Question      string `json:"question"`
	ExpectedCount int    `json:"expectedCount"`
}

type Candidate struct {
	Model       string   `json:"model"`
	DisplayName string   `json:"displayName"`
	Family      string   `json:"family"`
	FamilyName  string   `json:"familyName"`
	Probability *float64 `json:"probability"`
	Score       float64  `json:"score"`
}

type Sequence struct {
	Autocorrelation float64 `json:"autocorrelation"`
	SmallStepShare  float64 `json:"smallStepShare"`
	ModelLike       bool    `json:"modelLike"`
}

type BankInfo struct {
	Revision      string `json:"revision"`
	BuiltAt       string `json:"builtAt"`
	SourceCommit  string `json:"sourceCommit"`
	PortCommit    string `json:"portCommit"`
	SuiteRevision string `json:"suiteRevision"`
	ModelCount    int    `json:"modelCount"`
}

// Result probabilities only compare candidates present in ReferenceBank.
// A missing requested-model enrollment never creates an inferred alias.
type Result struct {
	ClosestModel         string      `json:"closestModel"`
	ClosestFamily        string      `json:"closestFamily"`
	EnrolledAs           string      `json:"enrolledAs"`
	Probability          *float64    `json:"probability"`
	RequestedProbability *float64    `json:"requestedProbability"`
	ReferenceMatched     bool        `json:"referenceMatched"`
	Decision             string      `json:"decision"`
	ValidSamples         int         `json:"validSamples"`
	Candidates           []Candidate `json:"candidates"`
	Sequence             *Sequence   `json:"sequence"`
	Mean                 float64     `json:"mean"`
	ReferenceBank        BankInfo    `json:"referenceBank"`
}

var enrollmentSuite, suiteInitializationErr = loadSuite()

func Available() bool {
	return initializationErr == nil && suiteInitializationErr == nil && len(enrollmentSuite) >= ChallengeCount
}

func ReferenceInfo() BankInfo {
	return BankInfo{
		Revision:      detectorRevision,
		BuiltAt:       sharedDetector.BankBuiltAt,
		SourceCommit:  SourceCommit,
		PortCommit:    PortCommit,
		SuiteRevision: fmt.Sprintf("sha256:%x", sha256.Sum256(enrollmentSuiteJSON)),
		ModelCount:    len(sharedDetector.models),
	}
}

// PolicyID changes whenever the frozen detector, challenge suite or supported
// alias policy changes, and is independent of the random challenges chosen.
func PolicyID() string {
	info := ReferenceInfo()
	return info.Revision + "/" + info.SuiteRevision + "/enrollment-aliases-v1/three-answers-v1"
}

// Challenges follows the enrollment procedure: draw three distinct prompts
// without replacement from the 36 environments, preserving their instructions.
func Challenges() []Challenge {
	if !Available() {
		return nil
	}
	out := make([]Challenge, ChallengeCount)
	for i, index := range rand.Perm(len(enrollmentSuite))[:ChallengeCount] {
		out[i] = enrollmentSuite[index]
	}
	return out
}

// ParseSample uses the upstream longest numeric-run parser. An overlong answer
// contributes only its requested prefix; short answers must meet the same
// max(80, ceil(expected*0.55)) minimum as the frozen enrollment detector.
func ParseSample(answer string, expectedCount int) ([]int, error) {
	if len(answer) > maxAnswerBytes {
		return nil, errors.New("指纹回答超过 64000 字节限制")
	}
	if expectedCount < 1 || expectedCount > 1000 {
		return nil, errors.New("指纹挑战的数字数量无效")
	}
	numbers := parseNumbers(answer)
	if len(numbers) > expectedCount {
		numbers = numbers[:expectedCount]
	}
	if len(numbers) < minimumNumbers(expectedCount) {
		return numbers, fmt.Errorf("指纹有效数字不足：取得 %d 个，至少需要 %d 个", len(numbers), minimumNumbers(expectedCount))
	}
	return numbers, nil
}

// Detect preserves the reference ranker, sequence gate and temperature
// calibration. One or two valid outputs may be ranked but get no probability.
func Detect(samples [][]int, requestedModel string) (r Result, err error) {
	r = Result{ReferenceBank: ReferenceInfo(), Candidates: []Candidate{}}
	defer func() {
		if recovered := recover(); recovered != nil {
			r = Result{ReferenceBank: ReferenceInfo(), Candidates: []Candidate{}}
			err = errors.New("指纹参考库的维度或计算结果无效")
		}
	}()
	if !Available() {
		return r, errors.New("指纹参考库或挑战题初始化失败")
	}
	if len(samples) < 1 || len(samples) > ChallengeCount {
		return r, errors.New("指纹归因需要一至三次有效数字序列")
	}
	outputs := make([]fingerprintOutput, len(samples))
	var count int
	var sum float64
	for i, numbers := range samples {
		if len(numbers) < 80 || len(numbers) > 1000 {
			return r, errors.New("指纹数字序列长度无效")
		}
		values := make([]string, len(numbers))
		for j, n := range numbers {
			if n < 1 || n > 355 {
				return r, errors.New("指纹数字必须为 1 至 355 的整数")
			}
			values[j] = strconv.Itoa(n)
			sum += float64(n)
			count++
		}
		outputs[i] = fingerprintOutput{Text: strings.Join(values, ","), ExpectedCount: len(numbers)}
	}
	r.Mean = sum / float64(count)
	attr, err := analyzeFingerprint(outputs)
	if err != nil {
		return r, err
	}
	r.ValidSamples = attr.Used
	r.Decision = attr.Decision
	if r.Decision == "" {
		r.Decision = "attributed"
	}
	r.ClosestModel = attr.Prediction
	r.ClosestFamily = attr.FamilyPrediction
	r.Probability = attr.Probability
	if attr.Sequence != nil {
		r.Sequence = &Sequence{attr.Sequence.Autocorrelation, attr.Sequence.SmallStepShare, attr.Sequence.ModelLike}
	}
	for _, candidate := range attr.Results {
		if math.IsNaN(candidate.Score) || math.IsInf(candidate.Score, 0) || candidate.Probability != nil && (math.IsNaN(*candidate.Probability) || math.IsInf(*candidate.Probability, 0) || *candidate.Probability < 0 || *candidate.Probability > 1) {
			return Result{ReferenceBank: ReferenceInfo()}, errors.New("指纹参考库返回无效归因概率")
		}
		r.Candidates = append(r.Candidates, Candidate{candidate.Model, candidate.DisplayName, candidate.Family, candidate.FamilyName, candidate.Probability, candidate.Score})
	}
	requested := canonicalModelID(requestedModel)
	for _, candidate := range sharedDetector.models {
		if candidate.ID == requested {
			r.EnrolledAs = candidate.ID
			break
		}
	}
	for _, candidate := range r.Candidates {
		if candidate.Model == r.EnrolledAs {
			r.RequestedProbability = candidate.Probability
			break
		}
	}
	r.ReferenceMatched = r.EnrolledAs != "" && r.ClosestModel == r.EnrolledAs
	return r, nil
}

func canonicalModelID(model string) string {
	model = strings.ToLower(strings.TrimSpace(model))
	model = model[strings.LastIndex(model, "/")+1:]
	// The pinned enrollment README explicitly groups gpt-6.1-sol answers under
	// gpt-6-astra. These aliases are part of the reference bank, not identity proof.
	switch model {
	case "gpt-6.1-sol":
		return "gpt-6-astra"
	case "deepseek-flash":
		return "deepseek-v4.1-flash-1017"
	default:
		return model
	}
}

func loadSuite() ([]Challenge, error) {
	var rows []struct {
		Condition     string `json:"condition"`
		System        string `json:"system"`
		UserPrefix    string `json:"user_prefix"`
		ChallengeID   string `json:"challenge_id"`
		Prompt        string `json:"prompt"`
		ExpectedCount int    `json:"expected_count"`
	}
	if err := json.Unmarshal(enrollmentSuiteJSON, &rows); err != nil {
		return nil, err
	}
	if len(rows) != 36 {
		return nil, errors.New("指纹参考挑战数量不匹配")
	}
	out := make([]Challenge, len(rows))
	for i, row := range rows {
		if row.ExpectedCount < 80 || row.ExpectedCount > 1000 || strings.TrimSpace(row.Prompt) == "" {
			return nil, errors.New("指纹参考挑战内容无效")
		}
		prompt := row.Prompt
		if row.UserPrefix != "" {
			prompt = row.UserPrefix + "\n\nFinal task:\n" + prompt
		}
		out[i] = Challenge{ID: row.Condition + "/" + row.ChallengeID, Instructions: row.System, Question: prompt, ExpectedCount: row.ExpectedCount}
	}
	return out, nil
}

func loadDetector() (d detector, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			d = detector{}
			err = errors.New("指纹参考库文件或校准绑定无效")
		}
	}()
	if len(detectorFile) < 8 {
		return d, errors.New("指纹参考库文件不完整")
	}
	d = decodeDetector(detectorFile, detectorModelsJSON)
	for _, value := range d.ResponseCounts {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 7 {
			return detector{}, errors.New("指纹参考样本数量无效")
		}
	}
	return d, nil
}

func mustDecode[T any](raw []byte) T {
	var result T
	if err := json.Unmarshal(raw, &result); err != nil {
		panic(err)
	}
	return result
}
