# 跨模块契约映射表（自动生成 · 勿手改）

> 由 `apps/userscript/scripts/verify_cross_module.js --emit-doc` 自动生成，记录「拼接式单 IIFE」下各模块之间的**裸全局**依赖。
> 仅列出被 ≥1 个其他模块引用的共享全局（已过滤局部变量/对象属性键噪声）。
> 构建门禁⑧（`--check-doc`）校验本文件与源码一致，漂移即报错 → 任何耦合变更必须显式重新生成。

## 共享全局 → 声明模块（被跨模块引用者）

| 共享全局 | 提供模块 | 引用模块数 |
| --- | --- | --- |
| `_accessibleWorkFrames` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `_ananasNeutralized` | `takeover/dom/lifecycle.js` | 1 |
| `_ananasPauseNoop` | `takeover/dom/dom.js` | 1 |
| `_attachGetter` | `takeover/engine/targeting.js` | 1 |
| `_attachHooked` | `takeover/engine/targeting.js` | 1 |
| `_bc` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_bxBuffer` | `takeover/foundation/state/metrics.js` | 1 |
| `_bxCap` | `takeover/foundation/state/metrics.js` | 1 |
| `_bxLog` | `takeover/foundation/state/metrics.js` | 2 |
| `_clearToastFeedPersist` | `presentation/panel-toast-feed.js` | 1 |
| `_courseInDisabledList` | `takeover/bootstrap/main-loop.js` | 1 |
| `_currentCourseId` | `takeover/bootstrap/main-loop.js` | 1 |
| `_cxActiveTab` | `presentation/panel.js` | 1 |
| `_cxAddons` | `plugins/registry.js` | 2 |
| `_cxAllFrames` | `presentation/diagnostics.js` | 3 |
| `_cxAuditLsKeys` | `presentation/diagnostics-audit.js` | 1 |
| `_cxAuditMediaSession` | `presentation/diagnostics-audit.js` | 1 |
| `_cxAuditProtoPause` | `presentation/diagnostics-audit.js` | 1 |
| `_cxAuditProtoRate` | `presentation/diagnostics-audit.js` | 1 |
| `_cxCmdFilter` | `presentation/commands.js` | 2 |
| `_cxCmdHi` | `presentation/commands.js` | 1 |
| `_cxCmdOnBlur` | `presentation/commands-palette.js` | 1 |
| `_cxCmdOnInput` | `presentation/commands-palette.js` | 1 |
| `_cxCmdOnKey` | `presentation/commands-palette.js` | 1 |
| `_cxCmdRender` | `presentation/commands-palette.js` | 1 |
| `_cxCmdShowAll` | `presentation/commands-palette.js` | 1 |
| `_cxCmdUpdate` | `presentation/commands-palette.js` | 2 |
| `_cxCommands` | `presentation/commands.js` | 1 |
| `_cxFavorites` | `presentation/commands.js` | 1 |
| `_cxFavToggle` | `presentation/commands.js` | 1 |
| `_cxIsChaoxingHost` | `takeover/foundation/utils/url.js` | 2 |
| `_cxPanel` | `presentation/panel.js` | 10 |
| `_cxPanelOwnerClaim` | `presentation/panel-core.js` | 3 |
| `_cxRecent` | `presentation/commands.js` | 1 |
| `_dashMoAgg` | `presentation/dashboard.js` | 1 |
| `_dbgTargetState` | `takeover/engine/targeting.js` | 1 |
| `_disarmVideoListeners` | `takeover/dom/dom.js` | 1 |
| `_dsAskQueue` | `takeover/engine/vision-deepseek-responder.js` | 1 |
| `_dsAskTryCount` | `takeover/engine/vision-deepseek-request.js` | 1 |
| `_dsBroadcastState` | `takeover/engine/vision-deepseek-status.js` | 1 |
| `_dsBroadcastTimer` | `takeover/engine/vision-deepseek-web.js` | 2 |
| `_dsClearBridge` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_dsConfToNum` | `takeover/engine/vision-deepseek-answer.js` | 1 |
| `_dsConsecFails` | `takeover/engine/vision-deepseek-request.js` | 1 |
| `_dsCountMessages` | `takeover/engine/vision-deepseek-messages.js` | 1 |
| `_dsCourseTimer` | `takeover/engine/vision-deepseek-web.js` | 2 |
| `_dsCurrentReqId` | `takeover/engine/vision-deepseek-responder.js` | 1 |
| `_dsDegradedUntil` | `takeover/engine/vision-deepseek-request.js` | 1 |
| `_dsEnsureChannel` | `takeover/engine/vision-deepseek-web.js` | 2 |
| `_dsEvictAll` | `takeover/engine/vision-deepseek-responder.js` | 1 |
| `_dsEvictGmId` | `takeover/engine/vision-deepseek-responder.js` | 1 |
| `_dsGmAskListenerId` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_dsGmListenerId` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_dsInitCourseSide` | `takeover/engine/vision-deepseek-status.js` | 1 |
| `_dsInitResponder` | `takeover/engine/vision-deepseek-responder.js` | 1 |
| `_dsInstallLightsMirror` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_dsIsLoggedIn` | `takeover/engine/vision-deepseek-status.js` | 2 |
| `_dsLastReplyBefore` | `takeover/engine/vision-deepseek-web.js` | 4 |
| `_dsLatestReply` | `takeover/engine/vision-deepseek-messages.js` | 2 |
| `_dsLatestReplyTextOnly` | `takeover/engine/vision-deepseek-messages.js` | 2 |
| `_dsLightsGmListenerId` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_dsLoop` | `takeover/engine/vision-deepseek-web.js` | 4 |
| `_dsNeedChannel` | `takeover/engine/vision-deepseek-web.js` | 2 |
| `_dsParseAnswer` | `takeover/engine/vision-deepseek-answer.js` | 3 |
| `_dsPasteImage` | `takeover/engine/vision-deepseek-messages.js` | 1 |
| `_dsReadConfidence` | `takeover/engine/vision-deepseek-answer.js` | 1 |
| `_dsRegTimer` | `takeover/engine/vision-deepseek-web.js` | 3 |
| `_dsRenderStatus` | `takeover/engine/vision-deepseek-status.js` | 1 |
| `_dsRespond` | `takeover/engine/vision-deepseek-compose.js` | 1 |
| `_dsResponding` | `takeover/engine/vision-deepseek-responder.js` | 1 |
| `_dsStreamStable` | `takeover/engine/vision-deepseek-web.js` | 2 |
| `_dsWatchdogTimer` | `takeover/engine/vision-deepseek-responder.js` | 1 |
| `_emitChannel` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_endedPrune` | `takeover/engine/dedup.js` | 1 |
| `_errBuf` | `takeover/foundation/state/metrics.js` | 1 |
| `_errCount` | `takeover/foundation/state/metrics.js` | 1 |
| `_evictLastUrl` | `takeover/bootstrap/main-loop.js` | 1 |
| `_evictLastVideoKey` | `takeover/bootstrap/main-loop.js` | 1 |
| `_evictPeriodTs` | `takeover/bootstrap/main-loop.js` | 1 |
| `_feedSubscribed` | `presentation/panel-toast-feed.js` | 1 |
| `_findFeedBox` | `presentation/panel-toast-feed.js` | 1 |
| `_flushToastFeed` | `presentation/panel-toast-feed.js` | 1 |
| `_installedProtoPause` | `takeover/foundation/meta-config/config.js` | 1 |
| `_installedProtoRateSet` | `takeover/foundation/meta-config/config.js` | 1 |
| `_isEffectiveTop` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `_lastDsAskReqId` | `takeover/engine/vision-deepseek-request.js` | 1 |
| `_lastMoBatches` | `presentation/dashboard.js` | 1 |
| `_lastVideoList` | `presentation/panel.js` | 2 |
| `_lockFg` | `takeover/engine/targeting.js` | 2 |
| `_loopLastTick` | `takeover/bootstrap/main-loop-scheduler.js` | 2 |
| `_loopTick` | `takeover/bootstrap/main-loop-tick.js` | 2 |
| `_loopTickDeltas` | `takeover/bootstrap/main-loop-scheduler.js` | 2 |
| `_loopTicks` | `takeover/bootstrap/main-loop-scheduler.js` | 3 |
| `_loopTimer` | `takeover/bootstrap/main-loop-scheduler.js` | 3 |
| `_markEnded` | `takeover/engine/dedup.js` | 1 |
| `_mediaSessionSaved` | `takeover/dom/lifecycle.js` | 2 |
| `_memPoll` | `takeover/dom/dom.js` | 1 |
| `_memSample` | `takeover/dom/dom.js` | 1 |
| `_mo` | `takeover/dom/dom.js` | 1 |
| `_MO_WARN_LEN` | `presentation/dashboard.js` | 1 |
| `_moBatches` | `takeover/dom/dom.js` | 1 |
| `_moFlushes` | `takeover/dom/dom.js` | 1 |
| `_moFlushRaf` | `takeover/dom/dom.js` | 1 |
| `_moFlushTimer` | `takeover/dom/dom.js` | 1 |
| `_moHistMax` | `takeover/foundation/state/metrics.js` | 1 |
| `_moHistory` | `takeover/foundation/state/metrics.js` | 2 |
| `_moLastBatchAt` | `takeover/dom/dom.js` | 1 |
| `_moPushes` | `takeover/dom/dom.js` | 1 |
| `_moQueue` | `takeover/dom/dom.js` | 1 |
| `_offChannel` | `takeover/engine/vision-deepseek-web.js` | 1 |
| `_onChannel` | `takeover/engine/vision-deepseek-web.js` | 3 |
| `_onTakeoverActive` | `takeover/bootstrap/main-loop.js` | 1 |
| `_onTakeoverInactive` | `takeover/bootstrap/main-loop.js` | 1 |
| `_onToastForFeed` | `presentation/panel-toast-feed.js` | 1 |
| `_origEventBus` | `takeover/foundation/state/state.js` | 1 |
| `_origMediaSessionPause` | `takeover/dom/lifecycle.js` | 2 |
| `_origMediaSessionState` | `takeover/dom/lifecycle.js` | 2 |
| `_origStore` | `takeover/foundation/state/state.js` | 1 |
| `_ownerReleaseFn` | `presentation/panel-core.js` | 1 |
| `_panelOutsideClickBound` | `presentation/panel-core.js` | 1 |
| `_pauseNeutralized` | `takeover/foundation/meta-config/config.js` | 1 |
| `_playWatchDocs` | `takeover/dom/lifecycle.js` | 2 |
| `_postChannel` | `takeover/engine/vision-deepseek-web.js` | 3 |
| `_pqQueryAll` | `sites/popup-quiz.js` | 3 |
| `_QUIZ_FULL_REFRESH_TICKS` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_QUIZ_LIGHTS_CAP` | `takeover/engine/quiz.js` | 1 |
| `_quizAiDiag` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizAIFailed` | `takeover/engine/quiz-popup-state.js` | 5 |
| `_quizAIPending` | `takeover/engine/quiz-popup-state.js` | 7 |
| `_quizAIProblems` | `takeover/engine/quiz-popup-state.js` | 5 |
| `_quizAnswerParse` | `takeover/engine/quiz-answer-parse.js` | 2 |
| `_quizAnswerToIdxs` | `takeover/engine/quiz-answer-parse.js` | 1 |
| `_quizAskAI` | `takeover/engine/quiz-answer-sources.js` | 1 |
| `_quizAskDeepSeekOverride` | `takeover/engine/vision-deepseek-request.js` | 1 |
| `_quizAutoStartOn` | `takeover/engine/quiz.js` | 2 |
| `_quizAutoSubmit` | `takeover/engine/quiz-fill-submit.js` | 1 |
| `_quizBankLookup` | `takeover/engine/quiz-answer-sources.js` | 2 |
| `_quizCancelForFp` | `takeover/engine/quiz.js` | 3 |
| `_quizCancelRequest` | `takeover/engine/quiz.js` | 2 |
| `_quizCancelSchedulers` | `takeover/engine/quiz.js` | 1 |
| `_quizCancelSubscription` | `takeover/engine/quiz.js` | 1 |
| `_quizCanRun` | `takeover/engine/quiz.js` | 7 |
| `_quizClearRequestTimer` | `takeover/engine/quiz.js` | 1 |
| `_quizClick` | `takeover/engine/quiz-answer-sources.js` | 3 |
| `_quizClosePopup` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizCmdHandler` | `takeover/engine/quiz-fill-submit.js` | 1 |
| `_quizConfirmDialog` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `_quizDecodeSecretText` | `takeover/engine/quiz-vision-font.js` | 1 |
| `_quizDetectedNotified` | `takeover/engine/quiz-tick.js` | 2 |
| `_quizDetectQType` | `takeover/engine/quiz-question.js` | 1 |
| `_quizDirtyGen` | `takeover/engine/quiz.js` | 4 |
| `_quizDisabledNotified` | `takeover/engine/quiz-tick.js` | 1 |
| `_quizDoneNotified` | `takeover/engine/quiz-tick.js` | 2 |
| `_quizDsGraceUntil` | `takeover/engine/quiz.js` | 3 |
| `_quizEndpointAllowed` | `takeover/engine/quiz-question.js` | 1 |
| `_quizEnsureVisible` | `takeover/engine/quiz-vision-snapshot.js` | 1 |
| `_quizEvictGmId` | `takeover/engine/quiz-answer-sources.js` | 1 |
| `_quizFillAnswer` | `takeover/engine/quiz-fill-submit.js` | 1 |
| `_quizFillEnabled` | `takeover/engine/quiz-fill-submit.js` | 1 |
| `_quizFillItems` | `takeover/engine/quiz-popup-state.js` | 4 |
| `_quizFingerprint` | `takeover/engine/quiz-question.js` | 2 |
| `_quizFinishRequest` | `takeover/engine/quiz.js` | 2 |
| `_quizFpCache` | `takeover/engine/quiz.js` | 2 |
| `_quizGateStorageHandler` | `takeover/engine/quiz.js` | 1 |
| `_quizHandled` | `takeover/engine/quiz.js` | 7 |
| `_quizInfoMissing` | `takeover/engine/quiz.js` | 4 |
| `_quizInstallCancellation` | `takeover/engine/quiz.js` | 1 |
| `_quizInstallEvictGM` | `takeover/engine/quiz-answer-sources.js` | 1 |
| `_quizInvalidateAsync` | `takeover/engine/quiz.js` | 3 |
| `_quizIsInPopup` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizIsMulti` | `takeover/engine/quiz-answer-sources.js` | 3 |
| `_quizLastActivityTs` | `takeover/engine/quiz.js` | 2 |
| `_quizLastAnswered` | `takeover/engine/quiz-tick.js` | 3 |
| `_quizLastHadQuestions` | `takeover/engine/quiz.js` | 3 |
| `_quizLastQuestions` | `takeover/engine/quiz.js` | 3 |
| `_quizLastScanAt` | `takeover/engine/quiz.js` | 2 |
| `_quizLastScanned` | `takeover/engine/quiz-tick.js` | 3 |
| `_quizLastTickErr` | `takeover/engine/quiz.js` | 3 |
| `_quizLightFp` | `takeover/engine/quiz.js` | 4 |
| `_quizLights` | `takeover/engine/quiz.js` | 4 |
| `_quizLightsGmSig` | `takeover/engine/quiz.js` | 2 |
| `_quizLightsSigLast` | `takeover/engine/quiz.js` | 2 |
| `_quizLoadByMirror` | `takeover/engine/quiz-vision.js` | 1 |
| `_quizManualArmed` | `takeover/engine/quiz.js` | 2 |
| `_quizManualHold` | `takeover/engine/quiz.js` | 4 |
| `_quizMaybeSubmit` | `takeover/engine/quiz-fill-submit.js` | 2 |
| `_quizMOBusy` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `_quizMOForced` | `takeover/engine/quiz-submit-observer.js` | 3 |
| `_quizMOTimer` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `_quizNewRequest` | `takeover/engine/quiz.js` | 2 |
| `_quizObserver` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `_quizOfflineOnly` | `takeover/engine/quiz-question.js` | 1 |
| `_quizOptions` | `takeover/engine/quiz-question.js` | 2 |
| `_quizPageSubmitted` | `takeover/engine/quiz-submit-observer.js` | 3 |
| `_quizParseSeq` | `takeover/engine/quiz-question.js` | 3 |
| `_quizPendingAI` | `takeover/engine/quiz.js` | 1 |
| `_quizPendingSubmit` | `takeover/engine/quiz-popup-state.js` | 10 |
| `_quizPopupOff` | `takeover/engine/quiz.js` | 2 |
| `_quizPruneAIFailed` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizPruneAIPending` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizPruneAIProblems` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizPruneFill` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizPruneHandled` | `takeover/engine/quiz-popup-state.js` | 2 |
| `_quizPrunePending` | `takeover/engine/quiz-popup-state.js` | 3 |
| `_quizPruneReviews` | `takeover/engine/quiz-popup-state.js` | 2 |
| `_quizQuestionSettled` | `takeover/engine/quiz.js` | 3 |
| `_quizRandomPick` | `takeover/engine/quiz-answer-sources.js` | 1 |
| `_quizRecordDiag` | `takeover/engine/quiz-popup-state.js` | 1 |
| `_quizRecoverOverride` | `takeover/engine/quiz-vision.js` | 1 |
| `_quizRefreshSettlementStats` | `takeover/engine/quiz.js` | 6 |
| `_quizRemoteOrder` | `takeover/engine/quiz.js` | 3 |
| `_quizRemoteState` | `takeover/engine/quiz.js` | 3 |
| `_quizRemoteTick` | `takeover/engine/quiz.js` | 2 |
| `_quizRequests` | `takeover/engine/quiz.js` | 2 |
| `_quizRequestValid` | `takeover/engine/quiz.js` | 2 |
| `_quizResolveAnswer` | `takeover/engine/quiz-answer-sources.js` | 1 |
| `_quizResumeSubscription` | `takeover/engine/quiz.js` | 1 |
| `_quizRetryTimer` | `takeover/engine/quiz.js` | 3 |
| `_quizReviewItems` | `takeover/engine/quiz-popup-state.js` | 9 |
| `_quizSchedule` | `takeover/engine/quiz.js` | 2 |
| `_quizSeqLabel` | `takeover/engine/quiz-question.js` | 2 |
| `_quizSeqWarnNotified` | `takeover/engine/quiz-tick.js` | 2 |
| `_quizSettled` | `takeover/engine/quiz.js` | 4 |
| `_quizSkipCounts` | `takeover/engine/quiz.js` | 3 |
| `_quizSnapshotOverride` | `takeover/engine/quiz-vision.js` | 1 |
| `_quizSource` | `takeover/engine/quiz-answer-sources.js` | 3 |
| `_quizStemCache` | `takeover/engine/quiz-question.js` | 1 |
| `_quizStrictAI` | `takeover/engine/quiz-popup-state.js` | 3 |
| `_quizStrictFail` | `takeover/engine/quiz-popup-state.js` | 2 |
| `_quizSubmit` | `takeover/engine/quiz-answer-sources.js` | 1 |
| `_quizSubmittedNotified` | `takeover/engine/quiz-submit-observer.js` | 2 |
| `_quizSubmitWithConfirm` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `_quizSyncLights` | `takeover/engine/quiz-lights.js` | 6 |
| `_quizText` | `takeover/engine/quiz-question.js` | 1 |
| `_quizTickCount` | `takeover/engine/quiz.js` | 2 |
| `_quizVisConfAction` | `takeover/engine/quiz-answer-sources.js` | 2 |
| `_quizVisGen` | `takeover/engine/quiz-vision-answer.js` | 4 |
| `_quizVisionAnswer` | `takeover/engine/quiz-vision-answer.js` | 1 |
| `_quizVisionCancelled` | `takeover/engine/quiz-vision-endpoint.js` | 1 |
| `_quizVisionCheckContext` | `takeover/engine/quiz-vision-endpoint.js` | 3 |
| `_quizVisionCreateContext` | `takeover/engine/quiz-vision-endpoint.js` | 2 |
| `_quizVisionHostAllowed` | `takeover/engine/quiz-vision-endpoint.js` | 1 |
| `_quizVisTimers` | `takeover/engine/quiz-vision-answer.js` | 6 |
| `_RATE_FAIR` | `presentation/dashboard.js` | 1 |
| `_RATE_GOOD` | `presentation/dashboard.js` | 1 |
| `_rateNeutralized` | `takeover/foundation/meta-config/config.js` | 1 |
| `_safePlayAttempts` | `takeover/foundation/state/metrics.js` | 2 |
| `_safePlaySuccesses` | `takeover/foundation/state/metrics.js` | 2 |
| `_secretGlyphMaps` | `takeover/engine/quiz-vision-font.js` | 1 |
| `_switchSubscribed` | `presentation/panel-core.js` | 1 |
| `_tamperAlarmed` | `takeover/bootstrap/main-loop.js` | 1 |
| `_targetHitHits` | `takeover/foundation/state/metrics.js` | 1 |
| `_targetHitSamples` | `takeover/foundation/state/metrics.js` | 1 |
| `_targetMissStreak` | `takeover/engine/targeting.js` | 4 |
| `_toastFeedBuf` | `presentation/panel-toast-feed.js` | 1 |
| `_toastFeedLog` | `presentation/panel-toast-feed.js` | 1 |
| `_topFeedMessageHandler` | `takeover/foundation/state/state.js` | 1 |
| `_topQuizLightsHandler` | `takeover/engine/quiz.js` | 2 |
| `_vidScanTick` | `takeover/bootstrap/main-loop-scheduler.js` | 1 |
| `_watchStats` | `takeover/engine/stats.js` | 2 |
| `activeVideo` | `takeover/dom/dom.js` | 1 |
| `allVideos` | `takeover/dom/dom.js` | 13 |
| `applyLoopAll` | `takeover/foundation/meta-config/prototype-controls.js` | 2 |
| `applyTakeoverNow` | `takeover/bootstrap/main-loop.js` | 1 |
| `applyUserRateAll` | `takeover/foundation/meta-config/prototype-controls.js` | 3 |
| `autoStopTick` | `takeover/dom/session.js` | 1 |
| `bestEffort` | `takeover/foundation/error-guard/guard.js` | 80 |
| `bindDSConsole` | `presentation/panel-ds-console.js` | 1 |
| `bindPanelControlEvents` | `presentation/panel-controls.js` | 1 |
| `BRIDGE` | `takeover/engine/bridge.js` | 6 |
| `BridgeCoordinator` | `takeover/engine/bridge-coordinator.js` | 1 |
| `bridgeEnabledByConfig` | `takeover/engine/bridge.js` | 1 |
| `bridgeInit` | `takeover/engine/bridge.js` | 1 |
| `buildDiagnostics` | `presentation/diagnostics.js` | 2 |
| `buildFeatureSelfTest` | `presentation/diagnostics-audit.js` | 1 |
| `buildInvasionReport` | `presentation/diagnostics-audit.js` | 1 |
| `buildPanelHTML` | `presentation/panel-template.js` | 1 |
| `CHAOXING_EXAM` | `sites/chaoxing-exam.js` | 1 |
| `clampCfg` | `takeover/foundation/storage/storage.js` | 2 |
| `CONFIG` | `takeover/foundation/meta-config/config.js` | 41 |
| `CONST` | `takeover/foundation/meta-config/config.js` | 14 |
| `consumeDomDirty` | `takeover/dom/dom.js` | 1 |
| `consumeVideoActivity` | `takeover/dom/dom.js` | 1 |
| `copyDiagnostics` | `presentation/diagnostics-panel.js` | 3 |
| `CoreState` | `takeover/foundation/state/runtime.js` | 17 |
| `createQuizSelectors` | `sites/quiz-selectors.js` | 4 |
| `currentSiteCfg` | `takeover/foundation/site/site-router.js` | 1 |
| `currentVideo` | `takeover/dom/dom.js` | 3 |
| `CX_KEYS` | `takeover/foundation/storage/keys.js` | 27 |
| `cxIcon` | `presentation/styles-tokens-icons.js` | 10 |
| `cxState` | `takeover/foundation/utils/utils.js` | 10 |
| `cxVideoOptOut` | `takeover/engine/policy.js` | 1 |
| `dbg` | `takeover/foundation/utils/utils.js` | 8 |
| `DEBUG` | `takeover/foundation/meta-config/config.js` | 9 |
| `decisionFor` | `takeover/engine/quiz-merge.js` | 1 |
| `DEEPSEEK` | `takeover/engine/vision-deepseek-web.js` | 2 |
| `DEFAULT_CONFIG` | `takeover/foundation/meta-config/config.js` | 1 |
| `detectSite` | `takeover/foundation/site/site-router.js` | 28 |
| `drainAddonQueue` | `plugins/registry.js` | 1 |
| `DS_ASK_MAX_RETRY` | `takeover/engine/vision-deepseek-request.js` | 1 |
| `DS_ASK_RETRY_DELAY` | `takeover/engine/vision-deepseek-request.js` | 1 |
| `DS_STATUS` | `takeover/engine/vision-deepseek-web.js` | 3 |
| `dsAvailable` | `takeover/engine/vision-deepseek-status.js` | 5 |
| `ENDED_SRCS` | `takeover/engine/dedup.js` | 6 |
| `ensurePanel` | `presentation/panel-core.js` | 1 |
| `errorCount` | `takeover/foundation/state/metrics.js` | 1 |
| `escapeHTML` | `takeover/foundation/utils/utils.js` | 7 |
| `EventBus` | `takeover/foundation/state/state.js` | 42 |
| `executeRawCmd` | `presentation/commands.js` | 2 |
| `fetchWithTimeout` | `takeover/foundation/utils/utils.js` | 2 |
| `FLAGS` | `takeover/foundation/meta-config/config.js` | 18 |
| `fmtTime` | `presentation/dashboard.js` | 2 |
| `forcePlayEnabled` | `takeover/engine/policy.js` | 1 |
| `foregroundVideo` | `takeover/engine/foreground.js` | 11 |
| `globalErrorHandler` | `takeover/bootstrap/core.js` | 1 |
| `hasCredentialConfigValue` | `takeover/foundation/storage/credentials.js` | 1 |
| `hideCmdList` | `presentation/commands-palette.js` | 1 |
| `hidePanel` | `presentation/panel.js` | 3 |
| `hookAttachments` | `takeover/engine/targeting.js` | 1 |
| `initBuiltinCommands` | `presentation/commands.js` | 1 |
| `installPlayWatch` | `takeover/bootstrap/main-loop.js` | 1 |
| `installPrototypePauseNeutralize` | `takeover/foundation/meta-config/prototype-controls.js` | 1 |
| `isCredentialConfigKey` | `takeover/foundation/storage/credentials.js` | 1 |
| `isEffectiveTopFrame` | `takeover/bootstrap/main-loop.js` | 3 |
| `isQuietPopups` | `presentation/toast.js` | 1 |
| `isRebuildFinished` | `takeover/engine/dedup.js` | 2 |
| `keydownHandler` | `presentation/panel.js` | 1 |
| `keyRe` | `takeover/engine/targeting.js` | 1 |
| `keyReAll` | `takeover/engine/targeting.js` | 1 |
| `loadPanelCfg` | `takeover/foundation/storage/storage.js` | 2 |
| `loadWatchStats` | `takeover/engine/stats.js` | 1 |
| `lsFlag` | `takeover/foundation/utils/utils.js` | 4 |
| `lsGet` | `takeover/foundation/utils/utils.js` | 1 |
| `lsSet` | `takeover/foundation/utils/utils.js` | 1 |
| `lsSetFlag` | `takeover/foundation/utils/utils.js` | 4 |
| `markDomDirty` | `takeover/dom/dom.js` | 5 |
| `mergeAnswers` | `takeover/engine/quiz-merge.js` | 1 |
| `NATIVE_PAUSE` | `takeover/foundation/meta-config/prototype-controls.js` | 5 |
| `NATIVE_PLAY` | `takeover/foundation/meta-config/prototype-controls.js` | 1 |
| `nearEnd` | `takeover/engine/playback.js` | 2 |
| `neutralizeGlobalPause` | `takeover/dom/dom.js` | 2 |
| `overrideVideo` | `takeover/dom/dom.js` | 1 |
| `panelNinjaOutsideClick` | `presentation/panel-core.js` | 2 |
| `pauseNoop` | `takeover/engine/playback.js` | 1 |
| `playWatchHandler` | `takeover/bootstrap/main-loop.js` | 1 |
| `POPUP_BOX_SELS` | `takeover/engine/quiz-popup-state.js` | 1 |
| `popupQuizTick` | `sites/popup-quiz.js` | 4 |
| `positionPanel` | `presentation/panel.js` | 1 |
| `probePauseNeutralized` | `takeover/foundation/meta-config/prototype-controls.js` | 1 |
| `probeRateNeutralized` | `takeover/foundation/meta-config/prototype-controls.js` | 1 |
| `QUIZ` | `takeover/engine/quiz.js` | 6 |
| `QUIZ_VISION` | `takeover/engine/quiz-vision.js` | 1 |
| `quizAskDeepSeek` | `takeover/engine/vision-deepseek-request.js` | 2 |
| `quizCredentialStore` | `takeover/foundation/storage/credentials.js` | 4 |
| `quizDisconnect` | `takeover/engine/quiz-submit-observer.js` | 1 |
| `quizHardReset` | `takeover/engine/quiz-exports.js` | 1 |
| `quizManualSubmit` | `takeover/engine/quiz-fill-submit.js` | 1 |
| `quizObserve` | `takeover/engine/quiz-submit-observer.js` | 2 |
| `quizOcr` | `takeover/engine/quiz-vision-snapshot.js` | 1 |
| `quizRecover` | `takeover/engine/quiz-vision-recover.js` | 2 |
| `quizScanOnce` | `takeover/engine/quiz-submit-observer.js` | 4 |
| `quizSnapshot` | `takeover/engine/quiz-vision-snapshot.js` | 1 |
| `quizSubmitPending` | `takeover/engine/quiz-fill-submit.js` | 2 |
| `quizSyncGate` | `takeover/engine/quiz.js` | 2 |
| `quizTick` | `takeover/engine/quiz-tick.js` | 9 |
| `quizVisionAsk` | `takeover/engine/quiz-vision-endpoint.js` | 2 |
| `recentErrors` | `takeover/foundation/state/metrics.js` | 1 |
| `reconcileIntrusionMode` | `takeover/foundation/meta-config/prototype-controls.js` | 5 |
| `recordWatchMs` | `takeover/engine/stats.js` | 1 |
| `refreshPanelLabels` | `presentation/panel.js` | 1 |
| `refreshPanelState` | `presentation/dashboard.js` | 1 |
| `refreshTargets` | `takeover/engine/targeting.js` | 3 |
| `registerCommand` | `presentation/commands.js` | 1 |
| `registerPopupQuizEnded` | `sites/popup-quiz.js` | 4 |
| `registerSiteTick` | `takeover/foundation/site/site-router.js` | 9 |
| `releaseVideo` | `takeover/engine/playback.js` | 3 |
| `renderDashboard` | `presentation/dashboard-render.js` | 1 |
| `renderQuizLights` | `presentation/dashboard-render.js` | 1 |
| `renderVideoList` | `presentation/dashboard-render.js` | 1 |
| `resolveBridgeBase` | `takeover/engine/bridge.js` | 1 |
| `restartLoopTimer` | `takeover/bootstrap/main-loop-scheduler.js` | 2 |
| `restoreGlobalPause` | `takeover/dom/lifecycle.js` | 1 |
| `restorePrototypeNeutralization` | `takeover/foundation/meta-config/prototype-controls.js` | 2 |
| `restorePrototypePause` | `takeover/foundation/meta-config/prototype-controls.js` | 1 |
| `restorePrototypeRate` | `takeover/foundation/meta-config/prototype-controls.js` | 1 |
| `resumeTick` | `takeover/dom/session.js` | 1 |
| `runSiteTick` | `takeover/foundation/site/site-router.js` | 1 |
| `safeCall` | `takeover/foundation/utils/utils.js` | 1 |
| `safeGet` | `takeover/foundation/error-guard/guard.js` | 54 |
| `safePlay` | `takeover/engine/playback.js` | 3 |
| `SAFETY` | `takeover/engine/safety.js` | 4 |
| `safetyScan` | `takeover/engine/safety.js` | 1 |
| `savePanelCfg` | `takeover/foundation/storage/storage.js` | 6 |
| `scanVideos` | `takeover/dom/dom.js` | 3 |
| `SCRIPT_VERSION` | `presentation/panel.js` | 4 |
| `SELECTORS` | `takeover/foundation/meta-config/config.js` | 2 |
| `shortSrc` | `takeover/engine/foreground.js` | 3 |
| `showPanel` | `presentation/panel.js` | 1 |
| `signatureOf` | `takeover/engine/dedup.js` | 1 |
| `singleVideoActive` | `takeover/bootstrap/main-loop.js` | 4 |
| `siteAnanas` | `takeover/foundation/site/site-router.js` | 1 |
| `siteAttachments` | `takeover/foundation/site/site-router.js` | 1 |
| `siteAttachmentsKey` | `takeover/foundation/site/site-router.js` | 2 |
| `siteTaskContainerSel` | `takeover/foundation/site/site-router.js` | 1 |
| `stopLoopTimer` | `takeover/bootstrap/main-loop-scheduler.js` | 2 |
| `STYLES` | `presentation/styles.js` | 10 |
| `swallow` | `takeover/foundation/utils/utils.js` | 14 |
| `syncBridgeFrames` | `takeover/engine/bridge.js` | 1 |
| `syncNinjaGlyph` | `presentation/panel.js` | 1 |
| `syncPanelInputs` | `presentation/panel.js` | 2 |
| `takeoverActive` | `takeover/bootstrap/main-loop.js` | 2 |
| `TARGET` | `takeover/engine/targeting.js` | 8 |
| `throttle` | `takeover/foundation/utils/utils.js` | 1 |
| `tickDriftGuards` | `takeover/dom/dom.js` | 1 |
| `toast` | `presentation/toast.js` | 2 |
| `toggleNinjaMode` | `presentation/panel.js` | 3 |
| `topHref` | `takeover/foundation/utils/url.js` | 6 |
| `urlParam` | `takeover/foundation/utils/url.js` | 6 |
| `usePrototypeNeutralize` | `takeover/foundation/meta-config/prototype-controls.js` | 1 |
| `userPause` | `takeover/dom/session.js` | 3 |
| `userResume` | `takeover/dom/session.js` | 4 |
| `videoBelongsToTask` | `takeover/engine/targeting.js` | 1 |
| `videoDriftStableKeys` | `takeover/engine/dedup.js` | 4 |
| `videoIframeSrcsOf` | `takeover/engine/dedup.js` | 1 |
| `videoSrcOf` | `takeover/engine/dedup.js` | 3 |
| `visibilityHandler` | `takeover/dom/dom.js` | 1 |
| `visThrottleHandler` | `takeover/bootstrap/main-loop-scheduler.js` | 1 |
| `zhihuishuFabTick` | `presentation/zhihuishu-fab.js` | 1 |

## 各模块依赖明细（仅显著共享符号）

### plugins/addons/auto-next-lifecycle.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (4): `FLAGS`, `NATIVE_PAUSE`, `bestEffort`, `swallow`

### plugins/addons/auto-next-navigation.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (3): `bestEffort`, `safeGet`, `swallow`

### plugins/addons/auto-next.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (9): `CONST`, `FLAGS`, `bestEffort`, `bridgeEnabledByConfig`, `lsFlag`, `lsSetFlag`, `resolveBridgeBase`, `safeGet`, `safePlay`

### plugins/addons/keyboard-shortcuts.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (1): `FLAGS`

### plugins/addons/quiet-popups.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (2): `lsFlag`, `lsSetFlag`

### plugins/addons/tamper-guard.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (2): `bestEffort`, `safeGet`

### plugins/addons/video-ended-notify.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (2): `bestEffort`, `safeGet`

### plugins/addons/zhihuishu-auto-next.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (2): `lsFlag`, `lsSetFlag`

### plugins/registry.js
- **provides（被跨模块引用）** (2): `_cxAddons`, `drainAddonQueue`
- **requires（跨模块解析）** (5): `STYLES`, `_cxPanel`, `bestEffort`, `cxIcon`, `registerCommand`

### presentation/commands-palette.js
- **provides（被跨模块引用）** (7): `_cxCmdOnBlur`, `_cxCmdOnInput`, `_cxCmdOnKey`, `_cxCmdRender`, `_cxCmdShowAll`, `_cxCmdUpdate`, `hideCmdList`
- **requires（跨模块解析）** (12): `STYLES`, `_cxCmdFilter`, `_cxCmdHi`, `_cxCommands`, `_cxFavorites`, `_cxPanel`, `_cxRecent`, `bestEffort`, `cxIcon`, `escapeHTML`, `executeRawCmd`, `initBuiltinCommands`

### presentation/commands.js
- **provides（被跨模块引用）** (9): `_cxCmdFilter`, `_cxCmdHi`, `_cxCommands`, `_cxFavToggle`, `_cxFavorites`, `_cxRecent`, `executeRawCmd`, `initBuiltinCommands`, `registerCommand`
- **requires（跨模块解析）** (27): `CONFIG`, `CX_KEYS`, `DEBUG`, `EventBus`, `FLAGS`, `_cxCmdShowAll`, `_cxCmdUpdate`, `_cxPanel`, `allVideos`, `applyLoopAll`, `applyUserRateAll`, `bestEffort`, `clampCfg`, `copyDiagnostics`, `currentVideo`, `foregroundVideo`, `hidePanel`, `safeGet`, `savePanelCfg`, `showPanel`, `swallow`, `syncPanelInputs`, `toggleNinjaMode`, `topHref`, `urlParam`, `userPause`, `userResume`

### presentation/dashboard-render.js
- **provides（被跨模块引用）** (3): `renderDashboard`, `renderQuizLights`, `renderVideoList`
- **requires（跨模块解析）** (26): `EventBus`, `FLAGS`, `STYLES`, `TARGET`, `_MO_WARN_LEN`, `_RATE_FAIR`, `_RATE_GOOD`, `_cxPanel`, `_cxPanelOwnerClaim`, `_dashMoAgg`, `_lastMoBatches`, `_lastVideoList`, `_moHistMax`, `_moHistory`, `_safePlayAttempts`, `_safePlaySuccesses`, `_targetHitHits`, `_targetHitSamples`, `allVideos`, `bestEffort`, `cxIcon`, `escapeHTML`, `fmtTime`, `foregroundVideo`, `shortSrc`, `singleVideoActive`

### presentation/dashboard.js
- **provides（被跨模块引用）** (7): `_MO_WARN_LEN`, `_RATE_FAIR`, `_RATE_GOOD`, `_dashMoAgg`, `_lastMoBatches`, `fmtTime`, `refreshPanelState`
- **requires（跨模块解析）** (24): `BRIDGE`, `CONFIG`, `CONST`, `CX_KEYS`, `ENDED_SRCS`, `FLAGS`, `SCRIPT_VERSION`, `STYLES`, `TARGET`, `_cxPanel`, `_cxPanelOwnerClaim`, `_targetMissStreak`, `activeVideo`, `allVideos`, `bestEffort`, `currentVideo`, `cxIcon`, `cxState`, `escapeHTML`, `refreshPanelLabels`, `renderDashboard`, `renderQuizLights`, `renderVideoList`, `safeGet`

### presentation/diagnostics-audit.js
- **provides（被跨模块引用）** (6): `_cxAuditLsKeys`, `_cxAuditMediaSession`, `_cxAuditProtoPause`, `_cxAuditProtoRate`, `buildFeatureSelfTest`, `buildInvasionReport`
- **requires（跨模块解析）** (12): `BRIDGE`, `CONFIG`, `SAFETY`, `_cxAddons`, `_loopTicks`, `_loopTimer`, `allVideos`, `bestEffort`, `buildDiagnostics`, `detectSite`, `foregroundVideo`, `safeGet`

### presentation/diagnostics-panel.js
- **provides（被跨模块引用）** (1): `copyDiagnostics`
- **requires（跨模块解析）** (25): `CONFIG`, `CX_KEYS`, `DEBUG`, `EventBus`, `FLAGS`, `_cxAddons`, `_cxAllFrames`, `_cxAuditMediaSession`, `_cxAuditProtoPause`, `_cxAuditProtoRate`, `_cxPanel`, `_playWatchDocs`, `_watchStats`, `bestEffort`, `buildDiagnostics`, `buildFeatureSelfTest`, `cxState`, `detectSite`, `fmtTime`, `foregroundVideo`, `isQuietPopups`, `isRebuildFinished`, `nearEnd`, `safeGet`, `shortSrc`

### presentation/diagnostics-quiz-engine.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (5): `CONFIG`, `_cxAllFrames`, `_loopTickDeltas`, `_moHistory`, `bestEffort`

### presentation/diagnostics-quiz-status.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (2): `_cxAllFrames`, `bestEffort`

### presentation/diagnostics.js
- **provides（被跨模块引用）** (2): `_cxAllFrames`, `buildDiagnostics`
- **requires（跨模块解析）** (21): `BRIDGE`, `CONFIG`, `CONST`, `CoreState`, `DEBUG`, `ENDED_SRCS`, `SCRIPT_VERSION`, `TARGET`, `_cxAuditLsKeys`, `_loopLastTick`, `_loopTicks`, `_loopTimer`, `_moBatches`, `_moFlushes`, `_moLastBatchAt`, `_moPushes`, `_moQueue`, `_targetMissStreak`, `allVideos`, `bestEffort`, `detectSite`

### presentation/panel-controls-data.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (16): `CONFIG`, `CX_KEYS`, `DEFAULT_CONFIG`, `EventBus`, `_bxBuffer`, `_bxCap`, `bestEffort`, `escapeHTML`, `hasCredentialConfigValue`, `isCredentialConfigKey`, `loadPanelCfg`, `quizCredentialStore`, `reconcileIntrusionMode`, `safeGet`, `savePanelCfg`, `swallow`

### presentation/panel-controls-quiz.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (7): `CONFIG`, `CX_KEYS`, `EventBus`, `bestEffort`, `detectSite`, `quizCredentialStore`, `safeGet`

### presentation/panel-controls.js
- **provides（被跨模块引用）** (1): `bindPanelControlEvents`
- **requires（跨模块解析）** (9): `CONFIG`, `EventBus`, `bestEffort`, `detectSite`, `reconcileIntrusionMode`, `safeGet`, `savePanelCfg`, `topHref`, `urlParam`

### presentation/panel-core-events.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (26): `CONFIG`, `EventBus`, `FLAGS`, `_cxCmdFilter`, `_cxCmdOnBlur`, `_cxCmdOnInput`, `_cxCmdOnKey`, `_cxCmdRender`, `_cxCmdUpdate`, `_cxFavToggle`, `_lastVideoList`, `_lockFg`, `allVideos`, `applyUserRateAll`, `bestEffort`, `clampCfg`, `currentVideo`, `executeRawCmd`, `foregroundVideo`, `hideCmdList`, `hidePanel`, `savePanelCfg`, `singleVideoActive`, `toggleNinjaMode`, `userPause`, `userResume`

### presentation/panel-core-navigation.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (20): `CONFIG`, `CX_KEYS`, `DEBUG`, `EventBus`, `FLAGS`, `_cxActiveTab`, `_cxPanel`, `_switchSubscribed`, `allVideos`, `applyLoopAll`, `bestEffort`, `bindDSConsole`, `bindPanelControlEvents`, `copyDiagnostics`, `detectSite`, `drainAddonQueue`, `positionPanel`, `savePanelCfg`, `syncPanelInputs`, `userResume`

### presentation/panel-core-ninja.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (4): `EventBus`, `_panelOutsideClickBound`, `bestEffort`, `panelNinjaOutsideClick`

### presentation/panel-core.js
- **provides（被跨模块引用）** (6): `_cxPanelOwnerClaim`, `_ownerReleaseFn`, `_panelOutsideClickBound`, `_switchSubscribed`, `ensurePanel`, `panelNinjaOutsideClick`
- **requires（跨模块解析）** (22): `CONFIG`, `EventBus`, `FLAGS`, `STYLES`, `_clearToastFeedPersist`, `_cxPanel`, `_feedSubscribed`, `_findFeedBox`, `_flushToastFeed`, `_onToastForFeed`, `_toastFeedBuf`, `_toastFeedLog`, `bestEffort`, `buildPanelHTML`, `copyDiagnostics`, `foregroundVideo`, `lsGet`, `lsSet`, `safeGet`, `toggleNinjaMode`, `userPause`, `userResume`

### presentation/panel-drag.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (0): —

### presentation/panel-ds-console.js
- **provides（被跨模块引用）** (1): `bindDSConsole`
- **requires（跨模块解析）** (7): `CX_KEYS`, `EventBus`, `bestEffort`, `cxIcon`, `escapeHTML`, `hidePanel`, `safeGet`

### presentation/panel-template-automation.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (1): `cxIcon`

### presentation/panel-template-monitor-system.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (3): `CONFIG`, `SCRIPT_VERSION`, `cxIcon`

### presentation/panel-template.js
- **provides（被跨模块引用）** (1): `buildPanelHTML`
- **requires（跨模块解析）** (6): `SCRIPT_VERSION`, `STYLES`, `currentSiteCfg`, `cxIcon`, `detectSite`, `escapeHTML`

### presentation/panel-toast-feed.js
- **provides（被跨模块引用）** (7): `_clearToastFeedPersist`, `_feedSubscribed`, `_findFeedBox`, `_flushToastFeed`, `_onToastForFeed`, `_toastFeedBuf`, `_toastFeedLog`
- **requires（跨模块解析）** (4): `EventBus`, `STYLES`, `bestEffort`, `safeGet`

### presentation/panel.js
- **provides（被跨模块引用）** (12): `SCRIPT_VERSION`, `_cxActiveTab`, `_cxPanel`, `_lastVideoList`, `hidePanel`, `keydownHandler`, `positionPanel`, `refreshPanelLabels`, `showPanel`, `syncNinjaGlyph`, `syncPanelInputs`, `toggleNinjaMode`
- **requires（跨模块解析）** (18): `CONFIG`, `CX_KEYS`, `DEBUG`, `EventBus`, `FLAGS`, `STYLES`, `_cxPanelOwnerClaim`, `_loopTick`, `bestEffort`, `buildInvasionReport`, `cxIcon`, `ensurePanel`, `escapeHTML`, `foregroundVideo`, `refreshPanelState`, `safeGet`, `throttle`, `toast`

### presentation/styles-tokens-icons.js
- **provides（被跨模块引用）** (1): `cxIcon`
- **requires（跨模块解析）** (2): `STYLES`, `bestEffort`

### presentation/styles.js
- **provides（被跨模块引用）** (1): `STYLES`
- **requires（跨模块解析）** (0): —

### presentation/toast.js
- **provides（被跨模块引用）** (2): `isQuietPopups`, `toast`
- **requires（跨模块解析）** (4): `CX_KEYS`, `STYLES`, `bestEffort`, `cxState`

### presentation/zhihuishu-fab.js
- **provides（被跨模块引用）** (1): `zhihuishuFabTick`
- **requires（跨模块解析）** (7): `CX_KEYS`, `EventBus`, `bestEffort`, `cxIcon`, `detectSite`, `dsAvailable`, `safeGet`

### sites/chaoxing-exam.js
- **provides（被跨模块引用）** (1): `CHAOXING_EXAM`
- **requires（跨模块解析）** (5): `bestEffort`, `detectSite`, `quizTick`, `registerSiteTick`, `safeGet`

### sites/icourse163.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (6): `bestEffort`, `detectSite`, `popupQuizTick`, `registerPopupQuizEnded`, `registerSiteTick`, `safeGet`

### sites/icve.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (6): `bestEffort`, `detectSite`, `popupQuizTick`, `registerPopupQuizEnded`, `registerSiteTick`, `safeGet`

### sites/ilabx.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (6): `bestEffort`, `createQuizSelectors`, `detectSite`, `quizTick`, `registerSiteTick`, `safeGet`

### sites/popup-quiz.js
- **provides（被跨模块引用）** (3): `_pqQueryAll`, `popupQuizTick`, `registerPopupQuizEnded`
- **requires（跨模块解析）** (7): `CONST`, `CX_KEYS`, `CoreState`, `EventBus`, `bestEffort`, `detectSite`, `safeGet`

### sites/quiz-selectors.js
- **provides（被跨模块引用）** (1): `createQuizSelectors`
- **requires（跨模块解析）** (0): —

### sites/renwei.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (6): `bestEffort`, `createQuizSelectors`, `detectSite`, `quizTick`, `registerSiteTick`, `safeGet`

### sites/ucampus.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (6): `bestEffort`, `createQuizSelectors`, `detectSite`, `quizTick`, `registerSiteTick`, `safeGet`

### sites/unipus.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (6): `bestEffort`, `createQuizSelectors`, `detectSite`, `quizTick`, `registerSiteTick`, `safeGet`

### sites/xuetangx.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (6): `bestEffort`, `detectSite`, `popupQuizTick`, `registerPopupQuizEnded`, `registerSiteTick`, `safeGet`

### sites/zhihuishu-exam-state.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (3): `EventBus`, `bestEffort`, `safeGet`

### sites/zhihuishu-exam.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (7): `CONFIG`, `CX_KEYS`, `bestEffort`, `dsAvailable`, `lsFlag`, `lsSetFlag`, `safeGet`

### sites/zhihuishu.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (7): `bestEffort`, `detectSite`, `popupQuizTick`, `registerPopupQuizEnded`, `registerSiteTick`, `safeGet`, `zhihuishuFabTick`

### takeover/bootstrap/core.js
- **provides（被跨模块引用）** (1): `globalErrorHandler`
- **requires（跨模块解析）** (0): —

### takeover/bootstrap/main-loop-scheduler.js
- **provides（被跨模块引用）** (8): `_loopLastTick`, `_loopTickDeltas`, `_loopTicks`, `_loopTimer`, `_vidScanTick`, `restartLoopTimer`, `stopLoopTimer`, `visThrottleHandler`
- **requires（跨模块解析）** (22): `BRIDGE`, `CONFIG`, `CoreState`, `ENDED_SRCS`, `EventBus`, `TARGET`, `_currentCourseId`, `_loopTick`, `_watchStats`, `applyTakeoverNow`, `bestEffort`, `detectSite`, `isEffectiveTopFrame`, `markDomDirty`, `quizObserve`, `quizScanOnce`, `quizTick`, `reconcileIntrusionMode`, `savePanelCfg`, `singleVideoActive`, `takeoverActive`, `videoDriftStableKeys`

### takeover/bootstrap/main-loop-tick.js
- **provides（被跨模块引用）** (1): `_loopTick`
- **requires（跨模块解析）** (44): `CONFIG`, `CONST`, `CoreState`, `DEBUG`, `EventBus`, `SAFETY`, `TARGET`, `_cxPanel`, `_dbgTargetState`, `_evictLastUrl`, `_evictLastVideoKey`, `_evictPeriodTs`, `_loopLastTick`, `_loopTickDeltas`, `_loopTicks`, `_memPoll`, `_memSample`, `_onTakeoverActive`, `_onTakeoverInactive`, `_tamperAlarmed`, `_targetMissStreak`, `_vidScanTick`, `applyUserRateAll`, `autoStopTick`, `bestEffort`, `consumeDomDirty`, `consumeVideoActivity`, `dbg`, `detectSite`, `foregroundVideo`, `installPrototypePauseNeutralize`, `neutralizeGlobalPause`, `probePauseNeutralized`, `probeRateNeutralized`, `refreshTargets`, `resumeTick`, `runSiteTick`, `safetyScan`, `scanVideos`, `syncBridgeFrames`, `takeoverActive`, `tickDriftGuards`, `usePrototypeNeutralize`, `videoDriftStableKeys`

### takeover/bootstrap/main-loop.js
- **provides（被跨模块引用）** (14): `_courseInDisabledList`, `_currentCourseId`, `_evictLastUrl`, `_evictLastVideoKey`, `_evictPeriodTs`, `_onTakeoverActive`, `_onTakeoverInactive`, `_tamperAlarmed`, `applyTakeoverNow`, `installPlayWatch`, `isEffectiveTopFrame`, `playWatchHandler`, `singleVideoActive`, `takeoverActive`
- **requires（跨模块解析）** (29): `CONFIG`, `CoreState`, `EventBus`, `FLAGS`, `NATIVE_PAUSE`, `_mediaSessionSaved`, `_origMediaSessionPause`, `_origMediaSessionState`, `_playWatchDocs`, `allVideos`, `bestEffort`, `bridgeInit`, `dbg`, `foregroundVideo`, `hookAttachments`, `markDomDirty`, `neutralizeGlobalPause`, `overrideVideo`, `reconcileIntrusionMode`, `refreshTargets`, `releaseVideo`, `restartLoopTimer`, `restoreGlobalPause`, `restorePrototypeNeutralization`, `scanVideos`, `stopLoopTimer`, `topHref`, `urlParam`, `videoDriftStableKeys`

### takeover/bootstrap/warmup.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (3): `CX_KEYS`, `CoreState`, `EventBus`

### takeover/dom/dom.js
- **provides（被跨模块引用）** (23): `_ananasPauseNoop`, `_disarmVideoListeners`, `_memPoll`, `_memSample`, `_mo`, `_moBatches`, `_moFlushRaf`, `_moFlushTimer`, `_moFlushes`, `_moLastBatchAt`, `_moPushes`, `_moQueue`, `activeVideo`, `allVideos`, `consumeDomDirty`, `consumeVideoActivity`, `currentVideo`, `markDomDirty`, `neutralizeGlobalPause`, `overrideVideo`, `scanVideos`, `tickDriftGuards`, `visibilityHandler`
- **requires（跨模块解析）** (41): `BRIDGE`, `CONFIG`, `CONST`, `CoreState`, `DEBUG`, `ENDED_SRCS`, `EventBus`, `FLAGS`, `NATIVE_PAUSE`, `SELECTORS`, `TARGET`, `_ananasNeutralized`, `_bxLog`, `_endedPrune`, `_markEnded`, `_mediaSessionSaved`, `_origMediaSessionPause`, `_origMediaSessionState`, `bestEffort`, `cxState`, `cxVideoOptOut`, `dbg`, `detectSite`, `foregroundVideo`, `installPlayWatch`, `isRebuildFinished`, `nearEnd`, `pauseNoop`, `releaseVideo`, `safeCall`, `safeGet`, `safePlay`, `shortSrc`, `signatureOf`, `singleVideoActive`, `siteAnanas`, `siteTaskContainerSel`, `videoBelongsToTask`, `videoDriftStableKeys`, `videoIframeSrcsOf`, `videoSrcOf`

### takeover/dom/lifecycle.js
- **provides（被跨模块引用）** (6): `_ananasNeutralized`, `_mediaSessionSaved`, `_origMediaSessionPause`, `_origMediaSessionState`, `_playWatchDocs`, `restoreGlobalPause`
- **requires（跨模块解析）** (30): `CoreState`, `EventBus`, `FLAGS`, `_ananasPauseNoop`, `_attachGetter`, `_attachHooked`, `_cxPanel`, `_disarmVideoListeners`, `_loopTimer`, `_mo`, `_moFlushRaf`, `_moFlushTimer`, `_origEventBus`, `_origStore`, `_ownerReleaseFn`, `_quizCmdHandler`, `_topFeedMessageHandler`, `_topQuizLightsHandler`, `allVideos`, `bestEffort`, `globalErrorHandler`, `keydownHandler`, `panelNinjaOutsideClick`, `playWatchHandler`, `restorePrototypePause`, `restorePrototypeRate`, `siteAttachmentsKey`, `syncNinjaGlyph`, `visThrottleHandler`, `visibilityHandler`

### takeover/dom/session.js
- **provides（被跨模块引用）** (4): `autoStopTick`, `resumeTick`, `userPause`, `userResume`
- **requires（跨模块解析）** (17): `CONFIG`, `CoreState`, `ENDED_SRCS`, `EventBus`, `FLAGS`, `NATIVE_PAUSE`, `NATIVE_PLAY`, `allVideos`, `bestEffort`, `cxState`, `dbg`, `foregroundVideo`, `recordWatchMs`, `safePlay`, `topHref`, `urlParam`, `videoSrcOf`

### takeover/engine/bridge-coordinator.js
- **provides（被跨模块引用）** (1): `BridgeCoordinator`
- **requires（跨模块解析）** (3): `CONST`, `CoreState`, `bestEffort`

### takeover/engine/bridge.js
- **provides（被跨模块引用）** (5): `BRIDGE`, `bridgeEnabledByConfig`, `bridgeInit`, `resolveBridgeBase`, `syncBridgeFrames`
- **requires（跨模块解析）** (16): `BridgeCoordinator`, `CONST`, `CX_KEYS`, `CoreState`, `FLAGS`, `TARGET`, `_cxIsChaoxingHost`, `_targetMissStreak`, `bestEffort`, `cxState`, `dbg`, `markDomDirty`, `refreshTargets`, `safeGet`, `topHref`, `urlParam`

### takeover/engine/dedup.js
- **provides（被跨模块引用）** (8): `ENDED_SRCS`, `_endedPrune`, `_markEnded`, `isRebuildFinished`, `signatureOf`, `videoDriftStableKeys`, `videoIframeSrcsOf`, `videoSrcOf`
- **requires（跨模块解析）** (7): `CONST`, `TARGET`, `bestEffort`, `cxState`, `keyRe`, `keyReAll`, `safeGet`

### takeover/engine/foreground.js
- **provides（被跨模块引用）** (2): `foregroundVideo`, `shortSrc`
- **requires（跨模块解析）** (3): `_lockFg`, `allVideos`, `bestEffort`

### takeover/engine/playback.js
- **provides（被跨模块引用）** (4): `nearEnd`, `pauseNoop`, `releaseVideo`, `safePlay`
- **requires（跨模块解析）** (12): `CONFIG`, `CoreState`, `FLAGS`, `NATIVE_PAUSE`, `_bxLog`, `_safePlayAttempts`, `_safePlaySuccesses`, `bestEffort`, `cxState`, `markDomDirty`, `safeGet`, `videoSrcOf`

### takeover/engine/policy.js
- **provides（被跨模块引用）** (2): `cxVideoOptOut`, `forcePlayEnabled`
- **requires（跨模块解析）** (2): `CX_KEYS`, `safeGet`

### takeover/engine/quiz-answer-parse.js
- **provides（被跨模块引用）** (2): `_quizAnswerParse`, `_quizAnswerToIdxs`
- **requires（跨模块解析）** (0): —

### takeover/engine/quiz-answer-sources.js
- **provides（被跨模块引用）** (11): `_quizAskAI`, `_quizBankLookup`, `_quizClick`, `_quizEvictGmId`, `_quizInstallEvictGM`, `_quizIsMulti`, `_quizRandomPick`, `_quizResolveAnswer`, `_quizSource`, `_quizSubmit`, `_quizVisConfAction`
- **requires（跨模块解析）** (18): `CONFIG`, `CX_KEYS`, `QUIZ`, `_quizAIPending`, `_quizAnswerToIdxs`, `_quizCanRun`, `_quizCancelRequest`, `_quizEndpointAllowed`, `_quizFinishRequest`, `_quizNewRequest`, `_quizRefreshSettlementStats`, `_quizRequestValid`, `bestEffort`, `fetchWithTimeout`, `mergeAnswers`, `quizHardReset`, `safeGet`, `swallow`

### takeover/engine/quiz-exports.js
- **provides（被跨模块引用）** (1): `quizHardReset`
- **requires（跨模块解析）** (64): `CONFIG`, `CX_KEYS`, `EventBus`, `_quizAIFailed`, `_quizAIPending`, `_quizAIProblems`, `_quizAiDiag`, `_quizAnswerParse`, `_quizAutoStartOn`, `_quizDetectedNotified`, `_quizDirtyGen`, `_quizDisabledNotified`, `_quizDoneNotified`, `_quizDsGraceUntil`, `_quizFillItems`, `_quizFpCache`, `_quizHandled`, `_quizInfoMissing`, `_quizInstallCancellation`, `_quizInstallEvictGM`, `_quizInvalidateAsync`, `_quizLastActivityTs`, `_quizLastAnswered`, `_quizLastHadQuestions`, `_quizLastQuestions`, `_quizLastScanAt`, `_quizLastScanned`, `_quizLastTickErr`, `_quizLightFp`, `_quizLights`, `_quizLightsGmSig`, `_quizLightsSigLast`, `_quizMOForced`, `_quizManualArmed`, `_quizManualHold`, `_quizObserver`, `_quizPageSubmitted`, `_quizPendingSubmit`, `_quizPopupOff`, `_quizRemoteOrder`, `_quizRemoteState`, `_quizRemoteTick`, `_quizRetryTimer`, `_quizReviewItems`, `_quizSeqWarnNotified`, `_quizSettled`, `_quizSkipCounts`, `_quizStemCache`, `_quizSyncLights`, `_quizTickCount`, `_quizVisConfAction`, `_quizVisGen`, `_quizVisTimers`, `bestEffort`, `dbg`, `detectSite`, `quizDisconnect`, `quizManualSubmit`, `quizObserve`, `quizScanOnce`, `quizSubmitPending`, `quizSyncGate`, `quizTick`, `safeGet`

### takeover/engine/quiz-fill-submit.js
- **provides（被跨模块引用）** (7): `_quizAutoSubmit`, `_quizCmdHandler`, `_quizFillAnswer`, `_quizFillEnabled`, `_quizMaybeSubmit`, `quizManualSubmit`, `quizSubmitPending`
- **requires（跨模块解析）** (22): `CHAOXING_EXAM`, `CX_KEYS`, `EventBus`, `QUIZ`, `_pqQueryAll`, `_quizAIPending`, `_quizAskAI`, `_quizBankLookup`, `_quizCanRun`, `_quizConfirmDialog`, `_quizPendingSubmit`, `_quizPrunePending`, `_quizRefreshSettlementStats`, `_quizReviewItems`, `_quizSchedule`, `_quizSettled`, `_quizSource`, `_quizSubmitWithConfirm`, `_quizSyncLights`, `bestEffort`, `safeGet`, `swallow`

### takeover/engine/quiz-lights.js
- **provides（被跨模块引用）** (1): `_quizSyncLights`
- **requires（跨模块解析）** (31): `EventBus`, `_QUIZ_LIGHTS_CAP`, `_quizAIFailed`, `_quizAIPending`, `_quizAIProblems`, `_quizDsGraceUntil`, `_quizFillItems`, `_quizHandled`, `_quizInfoMissing`, `_quizLastAnswered`, `_quizLastScanned`, `_quizLastTickErr`, `_quizLightFp`, `_quizLights`, `_quizLightsGmSig`, `_quizLightsSigLast`, `_quizManualHold`, `_quizPendingSubmit`, `_quizQuestionSettled`, `_quizRemoteOrder`, `_quizRemoteState`, `_quizRemoteTick`, `_quizRequests`, `_quizReviewItems`, `_quizSkipCounts`, `_quizVisTimers`, `_topQuizLightsHandler`, `bestEffort`, `detectSite`, `dsAvailable`, `swallow`

### takeover/engine/quiz-merge.js
- **provides（被跨模块引用）** (2): `decisionFor`, `mergeAnswers`
- **requires（跨模块解析）** (0): —

### takeover/engine/quiz-popup-state.js
- **provides（被跨模块引用）** (21): `POPUP_BOX_SELS`, `_QUIZ_FULL_REFRESH_TICKS`, `_quizAIFailed`, `_quizAIPending`, `_quizAIProblems`, `_quizAiDiag`, `_quizClosePopup`, `_quizFillItems`, `_quizIsInPopup`, `_quizPendingSubmit`, `_quizPruneAIFailed`, `_quizPruneAIPending`, `_quizPruneAIProblems`, `_quizPruneFill`, `_quizPruneHandled`, `_quizPrunePending`, `_quizPruneReviews`, `_quizRecordDiag`, `_quizReviewItems`, `_quizStrictAI`, `_quizStrictFail`
- **requires（跨模块解析）** (10): `CONFIG`, `CONST`, `EventBus`, `_quizCancelForFp`, `_quizHandled`, `_quizIsMulti`, `_quizParseSeq`, `bestEffort`, `safeGet`, `swallow`

### takeover/engine/quiz-question.js
- **provides（被跨模块引用）** (9): `_quizDetectQType`, `_quizEndpointAllowed`, `_quizFingerprint`, `_quizOfflineOnly`, `_quizOptions`, `_quizParseSeq`, `_quizSeqLabel`, `_quizStemCache`, `_quizText`
- **requires（跨模块解析）** (7): `CONFIG`, `CX_KEYS`, `QUIZ`, `_quizDirtyGen`, `_quizFpCache`, `bestEffort`, `safeGet`

### takeover/engine/quiz-review.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (12): `CX_KEYS`, `EventBus`, `QUIZ`, `_quizCanRun`, `_quizClick`, `_quizOptions`, `_quizPendingSubmit`, `_quizRefreshSettlementStats`, `_quizReviewItems`, `_quizSyncLights`, `bestEffort`, `safeGet`

### takeover/engine/quiz-submit-observer.js
- **provides（被跨模块引用）** (13): `_accessibleWorkFrames`, `_isEffectiveTop`, `_quizConfirmDialog`, `_quizMOBusy`, `_quizMOForced`, `_quizMOTimer`, `_quizObserver`, `_quizPageSubmitted`, `_quizSubmitWithConfirm`, `_quizSubmittedNotified`, `quizDisconnect`, `quizObserve`, `quizScanOnce`
- **requires（跨模块解析）** (24): `POPUP_BOX_SELS`, `QUIZ`, `_pqQueryAll`, `_quizAutoSubmit`, `_quizCanRun`, `_quizCancelSchedulers`, `_quizCancelSubscription`, `_quizDirtyGen`, `_quizEvictGmId`, `_quizGateStorageHandler`, `_quizInvalidateAsync`, `_quizPendingAI`, `_quizPendingSubmit`, `_quizResumeSubscription`, `_quizRetryTimer`, `_quizReviewItems`, `_quizSchedule`, `_quizSubmit`, `_quizVisGen`, `_quizVisTimers`, `bestEffort`, `isEffectiveTopFrame`, `quizTick`, `safeGet`

### takeover/engine/quiz-tick-finalize.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (35): `EventBus`, `_quizAIFailed`, `_quizAIPending`, `_quizAIProblems`, `_quizCanRun`, `_quizCancelForFp`, `_quizDetectedNotified`, `_quizDoneNotified`, `_quizFillItems`, `_quizFingerprint`, `_quizHandled`, `_quizInfoMissing`, `_quizLastActivityTs`, `_quizLastAnswered`, `_quizLastHadQuestions`, `_quizLastQuestions`, `_quizLastScanned`, `_quizLightFp`, `_quizLights`, `_quizMOForced`, `_quizManualHold`, `_quizOfflineOnly`, `_quizPendingSubmit`, `_quizQuestionSettled`, `_quizRefreshSettlementStats`, `_quizRetryTimer`, `_quizReviewItems`, `_quizSeqWarnNotified`, `_quizSettled`, `_quizStrictAI`, `_quizSyncLights`, `_quizVisGen`, `_quizVisTimers`, `bestEffort`, `quizTick`

### takeover/engine/quiz-tick.js
- **provides（被跨模块引用）** (7): `_quizDetectedNotified`, `_quizDisabledNotified`, `_quizDoneNotified`, `_quizLastAnswered`, `_quizLastScanned`, `_quizSeqWarnNotified`, `quizTick`
- **requires（跨模块解析）** (76): `CONFIG`, `CX_KEYS`, `EventBus`, `QUIZ`, `_QUIZ_FULL_REFRESH_TICKS`, `_accessibleWorkFrames`, `_isEffectiveTop`, `_pqQueryAll`, `_quizAIFailed`, `_quizAIPending`, `_quizAIProblems`, `_quizAutoStartOn`, `_quizCanRun`, `_quizCancelForFp`, `_quizClick`, `_quizClosePopup`, `_quizDetectQType`, `_quizDirtyGen`, `_quizDsGraceUntil`, `_quizFillAnswer`, `_quizFillEnabled`, `_quizFillItems`, `_quizFingerprint`, `_quizHandled`, `_quizInfoMissing`, `_quizInvalidateAsync`, `_quizIsInPopup`, `_quizIsMulti`, `_quizLastHadQuestions`, `_quizLastQuestions`, `_quizLastScanAt`, `_quizLastTickErr`, `_quizLightFp`, `_quizLights`, `_quizMOForced`, `_quizManualArmed`, `_quizManualHold`, `_quizMaybeSubmit`, `_quizOptions`, `_quizPageSubmitted`, `_quizParseSeq`, `_quizPendingSubmit`, `_quizPopupOff`, `_quizPruneAIFailed`, `_quizPruneAIPending`, `_quizPruneFill`, `_quizPruneHandled`, `_quizPrunePending`, `_quizPruneReviews`, `_quizQuestionSettled`, `_quizRandomPick`, `_quizRefreshSettlementStats`, `_quizRemoteOrder`, `_quizRemoteState`, `_quizRequests`, `_quizResolveAnswer`, `_quizReviewItems`, `_quizSeqLabel`, `_quizSettled`, `_quizSkipCounts`, `_quizSource`, `_quizStrictAI`, `_quizStrictFail`, `_quizSubmittedNotified`, `_quizText`, `_quizTickCount`, `_quizVisGen`, `_quizVisTimers`, `_quizVisionAnswer`, `bestEffort`, `decisionFor`, `dsAvailable`, `quizRecover`, `quizSyncGate`, `safeGet`, `swallow`

### takeover/engine/quiz-vision-answer.js
- **provides（被跨模块引用）** (3): `_quizVisGen`, `_quizVisTimers`, `_quizVisionAnswer`
- **requires（跨模块解析）** (35): `CONFIG`, `EventBus`, `_quizAIFailed`, `_quizAIProblems`, `_quizAnswerParse`, `_quizBankLookup`, `_quizCanRun`, `_quizCancelRequest`, `_quizClearRequestTimer`, `_quizClick`, `_quizFinishRequest`, `_quizHandled`, `_quizIsMulti`, `_quizMaybeSubmit`, `_quizNewRequest`, `_quizPageSubmitted`, `_quizParseSeq`, `_quizPendingSubmit`, `_quizPruneAIProblems`, `_quizPruneHandled`, `_quizPrunePending`, `_quizPruneReviews`, `_quizRecordDiag`, `_quizRefreshSettlementStats`, `_quizRequestValid`, `_quizReviewItems`, `_quizSeqLabel`, `_quizSource`, `_quizStrictAI`, `_quizStrictFail`, `_quizSyncLights`, `_quizVisConfAction`, `bestEffort`, `quizRecover`, `swallow`

### takeover/engine/quiz-vision-endpoint.js
- **provides（被跨模块引用）** (5): `_quizVisionCancelled`, `_quizVisionCheckContext`, `_quizVisionCreateContext`, `_quizVisionHostAllowed`, `quizVisionAsk`
- **requires（跨模块解析）** (5): `CONFIG`, `CoreState`, `_dsParseAnswer`, `fetchWithTimeout`, `quizCredentialStore`

### takeover/engine/quiz-vision-font.js
- **provides（被跨模块引用）** (2): `_quizDecodeSecretText`, `_secretGlyphMaps`
- **requires（跨模块解析）** (1): `safeGet`

### takeover/engine/quiz-vision-recover.js
- **provides（被跨模块引用）** (1): `quizRecover`
- **requires（跨模块解析）** (13): `CONFIG`, `_quizDecodeSecretText`, `_quizEnsureVisible`, `_quizRecoverOverride`, `_quizSnapshotOverride`, `_quizVisionCheckContext`, `_quizVisionCreateContext`, `_secretGlyphMaps`, `bestEffort`, `quizAskDeepSeek`, `quizOcr`, `quizSnapshot`, `quizVisionAsk`

### takeover/engine/quiz-vision-snapshot.js
- **provides（被跨模块引用）** (3): `_quizEnsureVisible`, `quizOcr`, `quizSnapshot`
- **requires（跨模块解析）** (3): `CONFIG`, `QUIZ_VISION`, `_quizLoadByMirror`

### takeover/engine/quiz-vision.js
- **provides（被跨模块引用）** (4): `QUIZ_VISION`, `_quizLoadByMirror`, `_quizRecoverOverride`, `_quizSnapshotOverride`
- **requires（跨模块解析）** (3): `CONFIG`, `EventBus`, `bestEffort`

### takeover/engine/quiz.js
- **provides（被跨模块引用）** (47): `QUIZ`, `_QUIZ_LIGHTS_CAP`, `_quizAutoStartOn`, `_quizCanRun`, `_quizCancelForFp`, `_quizCancelRequest`, `_quizCancelSchedulers`, `_quizCancelSubscription`, `_quizClearRequestTimer`, `_quizDirtyGen`, `_quizDsGraceUntil`, `_quizFinishRequest`, `_quizFpCache`, `_quizGateStorageHandler`, `_quizHandled`, `_quizInfoMissing`, `_quizInstallCancellation`, `_quizInvalidateAsync`, `_quizLastActivityTs`, `_quizLastHadQuestions`, `_quizLastQuestions`, `_quizLastScanAt`, `_quizLastTickErr`, `_quizLightFp`, `_quizLights`, `_quizLightsGmSig`, `_quizLightsSigLast`, `_quizManualArmed`, `_quizManualHold`, `_quizNewRequest`, `_quizPendingAI`, `_quizPopupOff`, `_quizQuestionSettled`, `_quizRefreshSettlementStats`, `_quizRemoteOrder`, `_quizRemoteState`, `_quizRemoteTick`, `_quizRequestValid`, `_quizRequests`, `_quizResumeSubscription`, `_quizRetryTimer`, `_quizSchedule`, `_quizSettled`, `_quizSkipCounts`, `_quizTickCount`, `_topQuizLightsHandler`, `quizSyncGate`
- **requires（跨模块解析）** (12): `CX_KEYS`, `CoreState`, `SAFETY`, `_quizAIPending`, `_quizMOBusy`, `_quizMOTimer`, `_quizPendingSubmit`, `_quizReviewItems`, `_quizSyncLights`, `_quizVisTimers`, `quizScanOnce`, `safeGet`

### takeover/engine/reverse-api.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (12): `CONFIG`, `_quizHandled`, `_quizPendingSubmit`, `_quizSubmittedNotified`, `_quizVisionCheckContext`, `_quizVisionCreateContext`, `bestEffort`, `detectSite`, `quizCredentialStore`, `quizScanOnce`, `quizSubmitPending`, `quizVisionAsk`

### takeover/engine/safety.js
- **provides（被跨模块引用）** (2): `SAFETY`, `safetyScan`
- **requires（跨模块解析）** (14): `CONFIG`, `CONST`, `CoreState`, `EventBus`, `allVideos`, `bestEffort`, `isEffectiveTopFrame`, `markDomDirty`, `reconcileIntrusionMode`, `releaseVideo`, `restartLoopTimer`, `restorePrototypeNeutralization`, `safeGet`, `stopLoopTimer`

### takeover/engine/stats.js
- **provides（被跨模块引用）** (3): `_watchStats`, `loadWatchStats`, `recordWatchMs`
- **requires（跨模块解析）** (4): `CONST`, `CX_KEYS`, `bestEffort`, `safeGet`

### takeover/engine/targeting.js
- **provides（被跨模块引用）** (11): `TARGET`, `_attachGetter`, `_attachHooked`, `_dbgTargetState`, `_lockFg`, `_targetMissStreak`, `hookAttachments`, `keyRe`, `keyReAll`, `refreshTargets`, `videoBelongsToTask`
- **requires（跨模块解析）** (12): `BRIDGE`, `CONST`, `ENDED_SRCS`, `EventBus`, `bestEffort`, `cxState`, `dbg`, `safeGet`, `siteAttachments`, `siteAttachmentsKey`, `topHref`, `urlParam`

### takeover/engine/vision-deepseek-answer.js
- **provides（被跨模块引用）** (3): `_dsConfToNum`, `_dsParseAnswer`, `_dsReadConfidence`
- **requires（跨模块解析）** (1): `safeGet`

### takeover/engine/vision-deepseek-bootstrap.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (41): `CONFIG`, `DEEPSEEK`, `DS_ASK_MAX_RETRY`, `DS_ASK_RETRY_DELAY`, `DS_STATUS`, `_bc`, `_dsAskQueue`, `_dsAskTryCount`, `_dsBroadcastState`, `_dsBroadcastTimer`, `_dsConfToNum`, `_dsCourseTimer`, `_dsCurrentReqId`, `_dsEnsureChannel`, `_dsEvictAll`, `_dsEvictGmId`, `_dsGmAskListenerId`, `_dsGmListenerId`, `_dsInitCourseSide`, `_dsInitResponder`, `_dsInstallLightsMirror`, `_dsIsLoggedIn`, `_dsLastReplyBefore`, `_dsLatestReply`, `_dsLatestReplyTextOnly`, `_dsLightsGmListenerId`, `_dsLoop`, `_dsNeedChannel`, `_dsParseAnswer`, `_dsReadConfidence`, `_dsRenderStatus`, `_dsResponding`, `_dsWatchdogTimer`, `_emitChannel`, `_lastDsAskReqId`, `_quizAskDeepSeekOverride`, `bestEffort`, `detectSite`, `dsAvailable`, `quizAskDeepSeek`, `safeGet`

### takeover/engine/vision-deepseek-compose.js
- **provides（被跨模块引用）** (1): `_dsRespond`
- **requires（跨模块解析）** (10): `CONFIG`, `_dsCountMessages`, `_dsLastReplyBefore`, `_dsLatestReply`, `_dsLatestReplyTextOnly`, `_dsParseAnswer`, `_dsPasteImage`, `_dsRegTimer`, `bestEffort`, `safeGet`

### takeover/engine/vision-deepseek-messages.js
- **provides（被跨模块引用）** (4): `_dsCountMessages`, `_dsLatestReply`, `_dsLatestReplyTextOnly`, `_dsPasteImage`
- **requires（跨模块解析）** (4): `_dsLastReplyBefore`, `_dsStreamStable`, `bestEffort`, `safeGet`

### takeover/engine/vision-deepseek-request.js
- **provides（被跨模块引用）** (8): `DS_ASK_MAX_RETRY`, `DS_ASK_RETRY_DELAY`, `_dsAskTryCount`, `_dsConsecFails`, `_dsDegradedUntil`, `_lastDsAskReqId`, `_quizAskDeepSeekOverride`, `quizAskDeepSeek`
- **requires（跨模块解析）** (13): `CONFIG`, `DS_STATUS`, `EventBus`, `_dsClearBridge`, `_dsEnsureChannel`, `_dsLoop`, `_dsRegTimer`, `_offChannel`, `_onChannel`, `_postChannel`, `_quizVisionCancelled`, `_quizVisionCheckContext`, `bestEffort`

### takeover/engine/vision-deepseek-responder.js
- **provides（被跨模块引用）** (7): `_dsAskQueue`, `_dsCurrentReqId`, `_dsEvictAll`, `_dsEvictGmId`, `_dsInitResponder`, `_dsResponding`, `_dsWatchdogTimer`
- **requires（跨模块解析）** (13): `CONFIG`, `_dsConsecFails`, `_dsDegradedUntil`, `_dsIsLoggedIn`, `_dsLastReplyBefore`, `_dsLoop`, `_dsRegTimer`, `_dsRespond`, `_dsStreamStable`, `_onChannel`, `_postChannel`, `bestEffort`, `detectSite`

### takeover/engine/vision-deepseek-status.js
- **provides（被跨模块引用）** (5): `_dsBroadcastState`, `_dsInitCourseSide`, `_dsIsLoggedIn`, `_dsRenderStatus`, `dsAvailable`
- **requires（跨模块解析）** (11): `DEEPSEEK`, `DS_STATUS`, `EventBus`, `_dsBroadcastTimer`, `_dsCourseTimer`, `_dsLoop`, `_dsNeedChannel`, `_onChannel`, `_postChannel`, `bestEffort`, `safeGet`

### takeover/engine/vision-deepseek-web.js
- **provides（被跨模块引用）** (20): `DEEPSEEK`, `DS_STATUS`, `_bc`, `_dsBroadcastTimer`, `_dsClearBridge`, `_dsCourseTimer`, `_dsEnsureChannel`, `_dsGmAskListenerId`, `_dsGmListenerId`, `_dsInstallLightsMirror`, `_dsLastReplyBefore`, `_dsLightsGmListenerId`, `_dsLoop`, `_dsNeedChannel`, `_dsRegTimer`, `_dsStreamStable`, `_emitChannel`, `_offChannel`, `_onChannel`, `_postChannel`
- **requires（跨模块解析）** (3): `EventBus`, `bestEffort`, `detectSite`

### takeover/foundation/error-guard/guard.js
- **provides（被跨模块引用）** (2): `bestEffort`, `safeGet`
- **requires（跨模块解析）** (1): `swallow`

### takeover/foundation/meta-config/config.js
- **provides（被跨模块引用）** (10): `CONFIG`, `CONST`, `DEBUG`, `DEFAULT_CONFIG`, `FLAGS`, `SELECTORS`, `_installedProtoPause`, `_installedProtoRateSet`, `_pauseNeutralized`, `_rateNeutralized`
- **requires（跨模块解析）** (3): `EventBus`, `loadPanelCfg`, `loadWatchStats`

### takeover/foundation/meta-config/prototype-controls.js
- **provides（被跨模块引用）** (12): `NATIVE_PAUSE`, `NATIVE_PLAY`, `applyLoopAll`, `applyUserRateAll`, `installPrototypePauseNeutralize`, `probePauseNeutralized`, `probeRateNeutralized`, `reconcileIntrusionMode`, `restorePrototypeNeutralization`, `restorePrototypePause`, `restorePrototypeRate`, `usePrototypeNeutralize`
- **requires（跨模块解析）** (15): `CONFIG`, `CONST`, `CoreState`, `FLAGS`, `_installedProtoPause`, `_installedProtoRateSet`, `_pauseNeutralized`, `_rateNeutralized`, `allVideos`, `bestEffort`, `cxState`, `dbg`, `detectSite`, `safeGet`, `scanVideos`

### takeover/foundation/site/site-router.js
- **provides（被跨模块引用）** (8): `currentSiteCfg`, `detectSite`, `registerSiteTick`, `runSiteTick`, `siteAnanas`, `siteAttachments`, `siteAttachmentsKey`, `siteTaskContainerSel`
- **requires（跨模块解析）** (5): `CoreState`, `SELECTORS`, `_cxIsChaoxingHost`, `bestEffort`, `safeGet`

### takeover/foundation/state/metrics.js
- **provides（被跨模块引用）** (13): `_bxBuffer`, `_bxCap`, `_bxLog`, `_errBuf`, `_errCount`, `_moHistMax`, `_moHistory`, `_safePlayAttempts`, `_safePlaySuccesses`, `_targetHitHits`, `_targetHitSamples`, `errorCount`, `recentErrors`
- **requires（跨模块解析）** (2): `bestEffort`, `safeGet`

### takeover/foundation/state/runtime.js
- **provides（被跨模块引用）** (1): `CoreState`
- **requires（跨模块解析）** (6): `CONFIG`, `EventBus`, `SAFETY`, `_courseInDisabledList`, `forcePlayEnabled`, `swallow`

### takeover/foundation/state/state.js
- **provides（被跨模块引用）** (4): `EventBus`, `_origEventBus`, `_origStore`, `_topFeedMessageHandler`
- **requires（跨模块解析）** (1): `swallow`

### takeover/foundation/storage/credentials.js
- **provides（被跨模块引用）** (3): `hasCredentialConfigValue`, `isCredentialConfigKey`, `quizCredentialStore`
- **requires（跨模块解析）** (4): `CONFIG`, `CX_KEYS`, `EventBus`, `_quizVisionHostAllowed`

### takeover/foundation/storage/data-governance.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (3): `CX_KEYS`, `EventBus`, `bestEffort`

### takeover/foundation/storage/keys.js
- **provides（被跨模块引用）** (1): `CX_KEYS`
- **requires（跨模块解析）** (0): —

### takeover/foundation/storage/storage.js
- **provides（被跨模块引用）** (3): `clampCfg`, `loadPanelCfg`, `savePanelCfg`
- **requires（跨模块解析）** (4): `CONFIG`, `CX_KEYS`, `DEBUG`, `swallow`

### takeover/foundation/utils/url.js
- **provides（被跨模块引用）** (3): `_cxIsChaoxingHost`, `topHref`, `urlParam`
- **requires（跨模块解析）** (1): `bestEffort`

### takeover/foundation/utils/utils.js
- **provides（被跨模块引用）** (11): `cxState`, `dbg`, `escapeHTML`, `fetchWithTimeout`, `lsFlag`, `lsGet`, `lsSet`, `lsSetFlag`, `safeCall`, `swallow`, `throttle`
- **requires（跨模块解析）** (8): `CX_KEYS`, `DEBUG`, `EventBus`, `_errBuf`, `_errCount`, `errorCount`, `recentErrors`, `toast`

### takeover/meta.js
- **provides（被跨模块引用）** (0): —
- **requires（跨模块解析）** (0): —

