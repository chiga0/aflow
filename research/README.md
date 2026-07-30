# aflow 预研与调研

本目录是研究内容的入口指引。实际研究文档位于 [`docs/research/`](../docs/research/index.md)，通过 MkDocs 部署到 [GitHub Pages](https://chiga0.github.io/aflow/)。

## 目录结构

```
docs/research/
├── index.md                        # 索引与状态总览
├── dashboard.md                    # 自动生成的状态看板（勿手动编辑）
├── _template.md                    # 新条目模板
└── <topic-slug>/
    └── README.md                   # 研究正文
```

## 添加新条目

1. 复制 `_template.md` 到 `docs/research/<topic-slug>/README.md`
2. 填写 frontmatter（title / status / tags / sources）和正文
3. 本地运行 `python scripts/research_status.py` 更新 dashboard
4. 提交并推送，Pages 自动部署

## 状态定义

| 状态 | 含义 |
|------|------|
| `draft` | 初始调研、信息收集 |
| `active` | 深入分析或原型验证中 |
| `concluded` | 已得出结论 / 决策 |
| `archived` | 不再跟进 |

## 自动化

- **每周状态扫描**：GitHub Action `research-weekly.yml` 每周一自动运行 `scripts/research_status.py`，更新 dashboard 并提交
- **Pages 部署**：推送到 `main` 后自动构建 MkDocs 并部署
