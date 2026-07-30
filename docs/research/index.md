# 预研与调研

aflow 团队的技术预研、方案调研与提案存档。每个子目录对应一个独立的研究课题。

## 如何添加新条目

1. 复制 [`_template.md`](_template.md) 到 `<topic-slug>/README.md`
2. 填写 frontmatter 和正文
3. 运行 `python scripts/research_status.py` 更新 dashboard
4. 提交推送，Pages 自动部署

## 状态定义

| 状态 | 含义 |
|------|------|
| `draft` | 初始调研、信息收集 |
| `active` | 深入分析或原型验证中 |
| `concluded` | 已得出结论 / 决策 |
| `archived` | 不再跟进 |

## 研究条目

详见 [状态看板](dashboard.md)（由 CI 自动生成）。
