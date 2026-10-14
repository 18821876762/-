// @provides: CX_KEYS
// ================================================================
// 全局 localStorage 键名常量（中央唯一来源）
// 所有读写 localStorage 的 cx_* 键名集中在此定义，杜绝散落漂移。
// 该片段在构建时排在 foundation/storage/storage.js 之前，被同一
// IIFE 包裹，故后续片段可直引 CX_KEYS。
//
// 外部/工具库（不在同一 IIFE 内）通过 window.__CX_FORCE_PLAY.KEYS 引用。
// ================================================================

var CX_KEYS = {
  //── 面板配置 ──
  PANEL_CFG:            'cx_panel_cfg',
  PANEL_TAB:            'cx_panel_tab',

  //── 答题引擎 ──
  QUIZ_AUTO:            'cx_quiz_auto',
  QUIZ_AUTO_START:      'cx_quiz_auto_start',
  QUIZ_OFFLINE:         'cx_quiz_offline',
  QUIZ_AUTO_SUBMIT:     'cx_quiz_autosubmit',
  QUIZ_SOURCE:          'cx_quiz_source',
  QUIZ_BANK:            'cx_quiz_bank',
  QUIZ_FILL_ENABLED:    'cx_quiz_fill_enabled',   // 填空题自动作答开关（默认关；仅题库/AI 命中，不自动提交）
  QUIZ_CDN:             'cx_quiz_cdn',

  //── 视觉识别 ──
  VISION_ENABLED:       'cx_quiz_vision_enabled',
  VISION_OCR:           'cx_quiz_vision_ocr',
  VISION_ENDPOINT:      'cx_quiz_vision_endpoint',
  VISION_OCR_LANG:      'cx_quiz_ocr_lang',
  VISION_PRIVACY:       'cx_quiz_vision_privacy',
  VISION_H2C_URL:       'cx_quiz_vision_h2c',
  VISION_USE_API_KEY:   'cx_quiz_vision_use_api_key',
  VISION_API_KEY:       'cx_quiz_vision_api_key',
  VISION_API_MODEL:     'cx_quiz_vision_api_model',

  //── 弹窗作答 ──
  POPUP_QUIZ:           'cx_popup_quiz',
  POPUP_BLOCK:          'cx_popup_block',

  //── 本地桥接 ──
  BRIDGE_BASE:          'cx_bridge_base',
  BRIDGE_OFF:           'cx_bridge_off',
  BRIDGE_ON:            'cx_bridge_on',

  //── 智慧树 ──
  ZH_EXAM_ON:           'cx_zh_exam_on',
  ZH_EXAM_AUTO_SUBMIT:  'cx_zh_exam_autosubmit',
  ZH_AUTO_NEXT:         'cx_zh_auto_next',

  //── 工具库项 ──
  AUTO_NEXT_ON:         'cx_an_on',

  //── 统计与命令 ──
  WATCH_STATS:          'cx_watch_stats',
  CMD_FAV:              'cx_cmd_fav',
  QUIET_POPUPS:         'cx_quiet_popups',

  //── 全局开关 ──
  FORCE_OFF:            'cx_force_off',

  //── DeepSeek 应答端 ──
  DS_RESPONDER:         'cx_ds_responder_enabled',

  //── KVS（仅 IndexedDB 库名，不是 localStorage 键，但命名同命名空间，集中在此外露）──
  KVS_DB:               'cx_kvs',
  FP_NS:                'cx_fp_'
};

// 暴露给 window 供不参加同一 IIFE 拼接的工具库项/外部脚本引用
// 注：此处不用 bestEffort（该函数在 guard.js 中定义，keys.js 需排在 utils.js 之前
// 保证 CX_KEYS 在最早引用点可用 → 直接 try/catch 兜底）。
try { window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {}; window.__CX_FORCE_PLAY.KEYS = CX_KEYS; } catch (e) {}
