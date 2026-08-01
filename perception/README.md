# 感知层 (Perception)

采集与状态观测。本层只「看」，不「改」平台数据。

- `chaoxing-media-collector.user.js` — 媒体采集器（视频/音频源、时长），本地存储、不联网。
- `chaoxing-progress-panel.user.js` — 只读课程/章节完成进度面板（副面板，内嵌主控）。
- `cx_crawler/` — Python 只读爬虫 + 本地桥服务（127.0.0.1:7531），抓取章节任务点/作业。
