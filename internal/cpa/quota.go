package cpa

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	fiveHourWindowSeconds = int64(5 * 3600)
	sevenDayWindowSeconds = int64(7 * 86400)
	minMonthWindowSeconds = int64(28 * 86400)
	maxMonthWindowSeconds = int64(31 * 86400)

	fiveHourWindowMinutes = 300
	sevenDayWindowMinutes = 10080
	minMonthWindowMinutes = 28 * 1440
	maxMonthWindowMinutes = 31 * 1440
)

func quotaWindowKeyFromSeconds(seconds int64) string {
	switch {
	case seconds == fiveHourWindowSeconds:
		return "5h"
	case seconds == sevenDayWindowSeconds:
		return "7d"
	case seconds >= minMonthWindowSeconds && seconds <= maxMonthWindowSeconds:
		return "30d"
	default:
		return ""
	}
}

func quotaWindowKeyFromMinutes(minutes int) string {
	switch {
	case minutes == fiveHourWindowMinutes:
		return "5h"
	case minutes == sevenDayWindowMinutes:
		return "7d"
	case minutes >= minMonthWindowMinutes && minutes <= maxMonthWindowMinutes:
		return "30d"
	default:
		return ""
	}
}

func isValidQuotaWindowKey(key string) bool {
	return key == "5h" || key == "7d" || key == "30d"
}

func quotaWindowOrder(key string) int {
	switch key {
	case "5h":
		return 0
	case "7d":
		return 1
	case "30d":
		return 2
	default:
		return 3
	}
}

func sortAndDedupeQuotaWindows(windows []QuotaWindow) []QuotaWindow {
	if len(windows) == 0 {
		return []QuotaWindow{}
	}
	latest := make(map[string]QuotaWindow, len(windows))
	for _, w := range windows {
		if !isValidQuotaWindowKey(w.Key) {
			continue
		}
		latest[w.Key] = w
	}
	if len(latest) == 0 {
		return []QuotaWindow{}
	}
	out := make([]QuotaWindow, 0, len(latest))
	for _, w := range latest {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool {
		return quotaWindowOrder(out[i].Key) < quotaWindowOrder(out[j].Key)
	})
	return out
}

func parseQuotaSignals(signals map[string]string, observed time.Time) Quota {
	q := Quota{Windows: []QuotaWindow{}, Status: "unknown"}
	if observed.IsZero() {
		return q
	}
	q.ObservedAt = observed.UTC().Format(time.RFC3339Nano)
	// HTTP 头名不区分大小写；CPA 管理接口会保留 X-Codex-* 的规范形式。
	// 复制后归一化，避免将真实额度误判为未知，也不修改调用方的观测数据。
	normalized := make(map[string]string, len(signals))
	for name, value := range signals {
		normalized[strings.ToLower(strings.TrimSpace(name))] = strings.TrimSpace(value)
	}
	signals = normalized
	for _, window := range []string{"primary", "secondary"} {
		base := "x-codex-" + window + "-"
		minutes, err := strconv.Atoi(signals[base+"window-minutes"])
		if err != nil {
			continue
		}
		key := quotaWindowKeyFromMinutes(minutes)
		if key == "" {
			continue
		}
		used, err := strconv.ParseFloat(signals[base+"used-percent"], 64)
		if err != nil || math.IsNaN(used) || math.IsInf(used, 0) || used < 0 || used > 100 {
			continue
		}
		seconds, err := strconv.ParseInt(signals[base+"reset-at"], 10, 64)
		reset := time.Unix(seconds, 0)
		if err != nil {
			after, afterErr := strconv.ParseInt(signals[base+"reset-after-seconds"], 10, 64)
			if afterErr != nil || after < 0 || after > 31536000 {
				continue
			}
			reset = observed.Add(time.Duration(after) * time.Second)
		}
		if !reset.After(time.Now()) {
			continue
		}
		remaining := 100 - used
		at := reset.UTC().Format(time.RFC3339)
		q.Windows = append(q.Windows, QuotaWindow{Key: key, RemainingPercent: &remaining, ResetsAt: &at})
		q.Status = "known"
	}
	q.Windows = sortAndDedupeQuotaWindows(q.Windows)
	if len(q.Windows) == 0 {
		q.Status = "unknown"
		return q
	}
	for _, w := range q.Windows {
		if w.RemainingPercent != nil && *w.RemainingPercent == 0 {
			q.Status = "exhausted"
		}
	}
	return q
}
