package classifier

import (
	"context"
	"strings"
)

type ManualVerdictRequest struct {
	CredentialID string `json:"credentialId"`
	Model        string `json:"model"`
	RoundID      string `json:"roundId,omitempty"`
	Verdict      string `json:"verdict"`
}

type ManualVerdictResponse struct {
	Verdict      string  `json:"verdict"`
	Status       string  `json:"status"`
	AppliedGroup *string `json:"appliedGroup"`
	Message      *string `json:"message"`
}

func hasPelicanPayload(p *Pelican) bool {
	return p != nil && (p.HTML != "" || p.HTMLBytes > 0 || p.SVG != "" || p.SVGBytes > 0)
}

func (s *Service) JudgePelican(ctx context.Context, q ManualVerdictRequest) (ManualVerdictResponse, error) {
	q.CredentialID = strings.TrimSpace(q.CredentialID)
	q.Model = strings.TrimSpace(q.Model)
	q.RoundID = strings.TrimSpace(q.RoundID)
	if q.CredentialID == "" {
		return ManualVerdictResponse{}, bad("必须指定 Codex 凭证 ID")
	}
	if q.Model == "" || len(q.Model) > 200 {
		return ManualVerdictResponse{}, bad("必须指定有效的检测模型")
	}
	if q.Verdict != "normal" && q.Verdict != "downshift" {
		return ManualVerdictResponse{}, bad("手动分组结论仅支持 normal 或 downshift")
	}

	s.mutation.Lock()
	defer s.mutation.Unlock()

	live, err := s.adapter.ListCredentials(ctx)
	if err != nil {
		return ManualVerdictResponse{}, err
	}
	var currentCred *struct {
		Disabled bool
	}
	for i := range live {
		if live[i].ID == q.CredentialID {
			currentCred = &struct{ Disabled bool }{Disabled: live[i].Disabled}
			break
		}
	}
	if currentCred == nil {
		return ManualVerdictResponse{}, &apiError{404, "Codex 凭证不存在"}
	}

	s.mu.Lock()
	if s.credentialBusyLocked(q.CredentialID) {
		s.mu.Unlock()
		return ManualVerdictResponse{}, &apiError{409, "该凭证仍在巡检任务中，请等待完成或停止后再判定分组"}
	}
	rec := s.recordLocked(q.CredentialID)
	if rec.InspectionExcluded {
		s.mu.Unlock()
		return ManualVerdictResponse{}, &apiError{409, "该凭证当前处于免检排除池，请先恢复参与后再判定分组"}
	}
	target, hasTarget := rec.Targets[q.Model]
	roundIdx := -1
	if hasTarget {
		for i, round := range target.Rounds {
			if q.RoundID != "" {
				if round.ID == q.RoundID {
					roundIdx = i
					break
				}
				continue
			}
			if hasPelicanPayload(round.Evidence.Pelican) {
				roundIdx = i
				break
			}
		}
	}
	if roundIdx < 0 || !hasPelicanPayload(target.Rounds[roundIdx].Evidence.Pelican) {
		s.mu.Unlock()
		return ManualVerdictResponse{}, &apiError{409, "该凭证尚未生成鹈鹕动画，请先执行绘制后再进行风控分组"}
	}
	settings := clone(s.state.Settings)
	s.mu.Unlock()

	if settings.Routing.Mode != "none" && currentCred.Disabled {
		return ManualVerdictResponse{}, &apiError{409, "该凭证已在 CPA 停用，请先开启凭证后再写入分组"}
	}

	desired := str(q.Verdict)
	now := stamp()
	var syncRecord Sync
	if settings.Routing.Mode == "none" {
		syncRecord = Sync{
			Mode:         "none",
			DesiredGroup: desired,
			AppliedGroup: desired,
			Status:       "not-needed",
			At:           &now,
		}
	} else {
		syncRecord, _ = s.apply(ctx, q.CredentialID, desired, settings)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	rec = s.recordLocked(q.CredentialID)
	target = rec.Targets[q.Model]
	if roundIdx >= len(target.Rounds) {
		return ManualVerdictResponse{}, &apiError{409, "目标检测轮次已变更，请刷新后重试"}
	}
	previousTarget := clone(target)
	previousGroup, previousSync := rec.Group, rec.Sync
	round := target.Rounds[roundIdx]
	round.Outcome = q.Verdict
	if q.Verdict == "normal" {
		round.ReasonCode = "pelican-judged-normal"
		round.Reason = "人工肉眼判定：正常（鹈鹕动画）"
	} else {
		round.ReasonCode = "pelican-judged-downshift"
		round.Reason = "人工肉眼判定：风控（鹈鹕动画）"
	}
	if round.Evidence.Pelican != nil {
		round.Evidence.Pelican.JudgedVerdict = q.Verdict
		round.Evidence.Pelican.JudgedAt = now
	}
	round.Sync = &syncRecord
	target.Rounds[roundIdx] = round
	target.Verdict = q.Verdict
	target.Blocked = nil
	rec.Targets[q.Model] = target
	if settings.Routing.Mode == "none" {
		rec.Group = desired
		rec.Sync = syncRecord
	}
	if err := s.persistLocked(); err != nil {
		rec.Targets[q.Model] = previousTarget
		rec.Group, rec.Sync = previousGroup, previousSync
		return ManualVerdictResponse{}, err
	}

	return ManualVerdictResponse{
		Verdict:      q.Verdict,
		Status:       syncRecord.Status,
		AppliedGroup: syncRecord.AppliedGroup,
		Message:      syncRecord.Message,
	}, nil
}
