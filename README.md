# Auto Cost

独立的人力成本管理与聚合查询系统。财务人员可导入月度工资、维护人员与成本、查看经营指标，并为第三方系统创建只返回整批总额的安全查询接口。

## 本地运行

```bash
cp .env.example .env.local
npm install
npm run dev
```

环境测试默认账号为 `admin / admin123`。本地数据写入 `.data/auto-cost.json`，该目录不会进入 Git。

## 生产环境

Vercel Marketplace 安装 Neon 后会自动注入唯一必需的生产变量：

```text
DATABASE_URL=<Neon Postgres 连接串>
```

V1 环境测试固定使用 `admin / admin123`。如需覆盖固定凭据或使用独立会话密钥，可额外配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`AUTH_SECRET`。未配置 `AUTH_SECRET` 时，生产环境使用 `DATABASE_URL` 经域隔离 SHA-256 派生会话签名密钥；数据库凭据轮换会使已有会话失效。

生产环境未连接 Neon 时应用会拒绝读取或写入工资数据，不会降级到 Vercel 临时文件系统。

## 验证

```bash
npm test
npm run lint
npm run typecheck
npm run build
PAYROLL_TEST_FILE=/absolute/path/to/2607工资.xlsx npm run test:e2e
```

详细设计和验收基线见 [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md) 与 [`docs/ACCEPTANCE_CRITERIA.md`](docs/ACCEPTANCE_CRITERIA.md)。
