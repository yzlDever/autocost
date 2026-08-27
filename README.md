# Auto Cost

独立的人力成本管理与聚合查询系统。财务人员可导入月度工资、维护人员与成本、查看经营指标，并为第三方系统创建只返回整批总额的安全查询接口。

## 本地运行

```bash
cp .env.example .env.local
npm install
npm run dev
```

环境测试默认账号为 `admin / admin123`。本地数据写入 `.data/auto-cost.json`，该目录不会进入 Git。

## 钉钉扫码登录

在钉钉开发者后台创建企业内部应用，并在“钉钉登录与分享”中配置本地回调地址。应用需要申请“成员信息读权限”，可使用范围仅选择财务人员；系统端还会使用 `DINGTALK_ALLOWED_USER_IDS` 再做一次白名单校验。

```text
DINGTALK_CLIENT_ID=<应用 Client ID>
DINGTALK_CLIENT_SECRET=<应用 Client Secret>
DINGTALK_REDIRECT_URI=http://localhost:3000/api/auth/dingtalk/callback
DINGTALK_CORP_ID=<企业 CorpId，可选但建议配置>
DINGTALK_ALLOWED_USER_IDS=<允许登录的钉钉 userId，多个用英文逗号分隔>
```

开发者后台的重定向 URL 必须与 `DINGTALK_REDIRECT_URI` 所使用的本地域名和端口一致。钉钉官方网页登录流程支持 `http://localhost` 用于开发测试。应用凭据与白名单只写入 `.env.local`，不得提交到代码仓库。

## 生产环境

Vercel Marketplace 安装 Neon 后会自动注入唯一必需的生产变量：

```text
DATABASE_URL=<Neon Postgres 连接串>
```

环境测试仍保留 `admin / admin123` 作为故障回退。正式开放时应配置独立 `AUTH_SECRET`、启用钉钉扫码登录，并移除或更换固定测试账号。未配置 `AUTH_SECRET` 时，生产环境使用 `DATABASE_URL` 经域隔离 SHA-256 派生会话签名密钥；数据库凭据轮换会使已有会话失效。

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
