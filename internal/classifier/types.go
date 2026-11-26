package classifier

import (
	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/cpa"
	"github.com/UangSC/cpa-gpt-risk-group-plugin/internal/fingerprint"
)

type RoutingValues struct {
	Priority int `json:"priority"`
	Weight   int `json:"weight"`
}
type RoutingSettings struct {
	Mode      string                   `json:"mode"`
	Groups    map[string]RoutingValues `json:"groups"`
	Overrides map[string]RoutingValues `json:"overrides"`
}
type TimeWindow struct {
	ID          string `json:"id"`
	StartMinute int    `json:"startMinute"`
	EndMinute   int    `json:"endMinute"`
}
type Pagination struct {
	List       int `json:"list"`
	Card       int `json:"card"`
	Pool       int `json:"pool"`
	Statistics int `json:"statistics"`
}

const maxStatisticsPageSize = 4

type Schedule struct {
	Enabled             bool         `json:"enabled"`
	Mode                string       `json:"mode"`
	IntervalMinutes     int          `json:"intervalMinutes"`
	DailyTime           string       `json:"dailyTime"`
	Windows             []TimeWindow `json:"windows"`
	BusySessionPolicy   string       `json:"busySessionPolicy,omitempty"`
	MaxBusySessions     int          `json:"maxBusySessions,omitempty"`
	MinRemainingPercent *float64     `json:"minRemainingPercent,omitempty"`
	NextRunAt           *string      `json:"nextRunAt"`
}
type Settings struct {
	Prefixes struct {
		Normal    string `json:"normal"`
		Downshift string `json:"downshift"`
	} `json:"prefixes"`
	Routing                     RoutingSettings `json:"routing"`
	InspectionMethod            string          `json:"inspectionMethod"`
	InspectFreeAccounts         bool            `json:"inspectFreeAccounts"`
	FingerprintThresholdPercent *float64        `json:"fingerprintThresholdPercent"`
	Retry                       struct {
		MaxRetries    int     `json:"maxRetries"`
		BaseDelayMs   int     `json:"baseDelayMs"`
		BackoffFactor float64 `json:"backoffFactor"`
	} `json:"retry"`
	FailureRule struct {
		WindowRounds     int `json:"windowRounds"`
		RequestThreshold int `json:"requestThreshold"`
	} `json:"failureRule"`
	Quota struct {
		MinRemainingPercent float64 `json:"minRemainingPercent"`
		UnknownPolicy       string  `json:"unknownPolicy"`
	} `json:"quota"`
	Concurrency struct {
		MaxObjects int `json:"maxObjects"`
	} `json:"concurrency"`
	InspectionModel string            `json:"inspectionModel"`
	ReasoningEffort string            `json:"reasoningEffort"`
	HeaderOverrides map[string]string `json:"headerOverrides"`
	Pagination      Pagination        `json:"pagination"`
	Layout          string            `json:"layout"`
	MaskNames       bool              `json:"maskNames"`
	Theme           string            `json:"theme"`
	Schedule        Schedule          `json:"schedule"`
	// 仅本次设置保存请求使用，不写入已保存设置或快照。
	AcknowledgeScheduledConfigChanges bool `json:"acknowledgeScheduledConfigChanges,omitempty"`
}

func DefaultSettings() Settings {
	var s Settings
	s.Prefixes.Downshift = "downshift"
	s.Routing = RoutingSettings{Mode: "none", Groups: map[string]RoutingValues{"normal": {Priority: 10, Weight: 10}, "downshift": {Priority: -10, Weight: 1}, "ungrouped": {Priority: 0, Weight: 10}}, Overrides: map[string]RoutingValues{}}
	s.InspectionMethod = "candy"
	defaultFingerprintThreshold := defaultFingerprintThresholdPercent
	s.FingerprintThresholdPercent = &defaultFingerprintThreshold
	s.InspectionModel = "gpt-6.1-sol"
	s.ReasoningEffort = "low"
	s.HeaderOverrides = map[string]string{}
	s.Pagination = Pagination{List: 10, Card: 12, Pool: 4, Statistics: maxStatisticsPageSize}
	s.Retry.MaxRetries = 2
	s.Retry.BaseDelayMs = 5000
	s.Retry.BackoffFactor = 2
	s.FailureRule.WindowRounds = 2
	s.FailureRule.RequestThreshold = 3
	s.Quota.MinRemainingPercent = 15
	s.Quota.UnknownPolicy = "check"
	s.Concurrency.MaxObjects = 4
	s.Layout = "pool"
	s.Theme = "light"
	defaultScheduledQuota := 15.0
	s.Schedule = Schedule{
		Mode:                "interval",
		IntervalMinutes:     60,
		DailyTime:           "09:00",
		Windows:             []TimeWindow{{"daytime", 540, 1080}},
		BusySessionPolicy:   "under-limit",
		MaxBusySessions:     3,
		MinRemainingPercent: &defaultScheduledQuota,
	}
	return s
}

type Sync struct {
	Mode         string  `json:"mode,omitempty"`
	DesiredGroup *string `json:"desiredGroup"`
	AppliedGroup *string `json:"appliedGroup"`
	Status       string  `json:"status"`
	At           *string `json:"at"`
	Message      *string `json:"message"`
}
type Credential struct {
	ID                 string        `json:"id"`
	Name               string        `json:"name"`
	File               string        `json:"file"`
	Plan               string        `json:"plan"`
	Auth               string        `json:"auth"`
	Availability       string        `json:"availability"`
	BusySessions       int           `json:"busySessions"`
	Quota              cpa.Quota     `json:"quota"`
	Models             []string      `json:"models"`
	Group              *string       `json:"group"`
	Sync               Sync          `json:"sync"`
	Routing            RoutingValues `json:"routing"`
	Disabled           bool          `json:"disabled,omitempty"`
	Unavailable        bool          `json:"unavailable,omitempty"`
	Prefix             string        `json:"prefix"`
	InspectionExcluded bool          `json:"inspectionExcluded"`
	ExcludedAt         *string       `json:"excludedAt"`
}
type Target struct {
	ID           string   `json:"id"`
	CredentialID string   `json:"credentialId"`
	Model        string   `json:"model"`
	Verdict      string   `json:"verdict"`
	Rounds       []Round  `json:"rounds"`
	Blocked      *Blocked `json:"blocked"`
}
type Blocked struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}
type Attempt struct {
	Index          int    `json:"index"`
	Status         any    `json:"status"`
	At             string `json:"at"`
	WaitMs         int    `json:"waitMs"`
	DurationMs     int64  `json:"durationMs"`
	Test           string `json:"test"`
	ChallengeIndex int    `json:"challengeIndex"`
	RetryIndex     int    `json:"retryIndex"`
	ValidResponse  bool   `json:"validResponse"`
	FinishedAt     string `json:"finishedAt,omitempty"`
	LocalState     bool   `json:"localState,omitempty"`
}
type EvidenceError struct {
	At      string `json:"at"`
	Code    int    `json:"code"`
	Message string `json:"message"`
}
type Candy struct {
	PromptID   string `json:"promptId"`
	Question   string `json:"question"`
	Expected   string `json:"expected"`
	Answer     string `json:"answer"`
	Matched    bool   `json:"matched"`
	FormatNote string `json:"formatNote"`
}

type Pelican struct {
	PromptID      string `json:"promptId"`
	Question      string `json:"question"`
	SVG           string `json:"svg,omitempty"`
	SVGBytes      int    `json:"svgBytes"`
	SVGPruned     bool   `json:"svgPruned,omitempty"`
	RawSnippet    string `json:"rawSnippet,omitempty"`
	StrictFormat  bool   `json:"strictFormat"`
	FormatNote    string `json:"formatNote"`
	JudgedVerdict string `json:"judgedVerdict,omitempty"`
	JudgedAt      string `json:"judgedAt,omitempty"`
}

type FingerprintSample struct {
	ChallengeID   string `json:"challengeId"`
	PromptSummary string `json:"promptSummary"`
	Question      string `json:"question"`
	Instructions  string `json:"instructions"`
	ExpectedCount int    `json:"expectedCount"`
	Numbers       []int  `json:"numbers"`
	Accepted      bool   `json:"accepted"`
	Sample        string `json:"sample"`
}

type Fingerprint struct {
	ChallengeCount       int                     `json:"challengeCount"`
	ValidSamples         int                     `json:"validSamples"`
	ClosestModel         *string                 `json:"closestModel"`
	ClosestFamily        *string                 `json:"closestFamily"`
	Probability          *float64                `json:"probability"`
	RequestedProbability *float64                `json:"requestedProbability"`
	Consistency          string                  `json:"consistency"`
	EnrolledAs           string                  `json:"enrolledAs"`
	Samples              []FingerprintSample     `json:"samples"`
	Threshold            float64                 `json:"threshold"`
	ReferenceMatched     bool                    `json:"referenceMatched"`
	Candidates           []fingerprint.Candidate `json:"candidates"`
	Mean                 *float64                `json:"mean"`
	Sequence             *fingerprint.Sequence   `json:"sequence"`
	ReferenceBank        fingerprint.BankInfo    `json:"referenceBank"`
	Decision             string                  `json:"decision"`
}
type Usage struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}
type ServiceErrors struct {
	Codes               []int  `json:"codes"`
	ErrorRoundsInWindow int    `json:"errorRoundsInWindow"`
	WindowSize          int    `json:"windowSize"`
	ErrorAttempts       int    `json:"errorAttempts,omitempty"`
	RequestThreshold    int    `json:"requestThreshold,omitempty"`
	Trigger             string `json:"trigger,omitempty"`
}
type Evidence struct {
	Tests        []string        `json:"tests"`
	Candy        *Candy          `json:"candy,omitempty"`
	Fingerprint  *Fingerprint    `json:"fingerprint,omitempty"`
	Pelican      *Pelican        `json:"pelican,omitempty"`
	Attempts     []Attempt       `json:"attempts"`
	Errors       []EvidenceError `json:"errors"`
	Usage        *Usage          `json:"usage"`
	DurationMs   int64           `json:"durationMs"`
	ServiceError *ServiceErrors  `json:"serviceError,omitempty"`
}
type Round struct {
	ID              string   `json:"id"`
	TaskID          string   `json:"taskId,omitempty"`
	BatchStartedAt  string   `json:"batchStartedAt,omitempty"`
	TargetID        string   `json:"targetId"`
	StartedAt       string   `json:"startedAt"`
	FinishedAt      string   `json:"finishedAt"`
	Scope           string   `json:"scope"`
	Tests           []string `json:"tests"`
	Outcome         string   `json:"outcome"`
	ReasonCode      string   `json:"reasonCode"`
	Reason          string   `json:"reason"`
	Evidence        Evidence `json:"evidence"`
	Sync            *Sync    `json:"sync"`
	ReasoningEffort string   `json:"reasoningEffort,omitempty"`
}
type RunItem struct {
	TargetID    string  `json:"targetId"`
	State       string  `json:"state"`
	Note        *string `json:"note"`
	StartedAt   *string `json:"startedAt"`
	FinishedAt  *string `json:"finishedAt"`
	Attempt     int     `json:"attempt"`
	CurrentTest *string `json:"currentTest"`
	LastStatus  any     `json:"lastStatus,omitempty"`
	RetryAt     *string `json:"retryAt,omitempty"`
}
type Task struct {
	ID          string    `json:"id"`
	Scope       string    `json:"scope"`
	Label       string    `json:"label"`
	Method      string    `json:"method,omitempty"`
	CreatedAt   string    `json:"createdAt"`
	FinishedAt  *string   `json:"finishedAt"`
	Status      string    `json:"status"`
	Items       []RunItem `json:"items"`
	Concurrency int       `json:"concurrency"`
}
type Record struct {
	Group              *string           `json:"group"`
	Sync               Sync              `json:"sync"`
	Targets            map[string]Target `json:"targets"`
	OriginalPrefix     *string           `json:"originalPrefix,omitempty"`
	InspectionExcluded bool              `json:"inspectionExcluded"`
	ExcludedAt         *string           `json:"excludedAt"`
	RefreshedQuota     *cpa.Quota        `json:"refreshedQuota,omitempty"`
}
type diskState struct {
	Version                            int                `json:"version"`
	Settings                           Settings           `json:"settings"`
	Records                            map[string]*Record `json:"records"`
	Tasks                              []Task             `json:"tasks"`
	ScheduledConfigChangesAcknowledged bool               `json:"scheduledConfigChangesAcknowledged,omitempty"`
	ScheduledConfigurationFingerprint  string             `json:"scheduledConfigurationFingerprint,omitempty"`
	ScheduleConsentRequired            bool               `json:"scheduleConsentRequired,omitempty"`
}
type Capabilities struct {
	RoutingStrategy       string `json:"routingStrategy"`
	WeightEditingEnabled  bool   `json:"weightEditingEnabled"`
	FingerprintAvailable  bool   `json:"fingerprintAvailable"`
	AvailabilityKnown     bool   `json:"availabilityKnown"`
	QuotaRefreshAvailable bool   `json:"quotaRefreshAvailable"`
}
type Snapshot struct {
	Credentials           []Credential             `json:"credentials"`
	Targets               []Target                 `json:"targets"`
	Settings              Settings                 `json:"settings"`
	Tasks                 []Task                   `json:"tasks"`
	Source                string                   `json:"source"`
	SourceDetail          string                   `json:"sourceDetail"`
	Capabilities          Capabilities             `json:"capabilities"`
	ConfigChangesRevision string                   `json:"configChangesRevision"`
	RequestHeaderProfile  cpa.RequestHeaderProfile `json:"requestHeaderProfile"`
}
