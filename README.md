# Auto Cost

独立的人力成本管理与聚合查询系统。财务人员可导入月度工资、维护人员与成本、查看经营指标，并为第三方系统创建只返回整批总额的安全查询接口。

## 工资导入流程

1. 在人员管理页同步钉钉通讯录。
2. 点击“下载工资模板”，系统会写入全部在册及历史人员的稳定人员 ID、工号、姓名、部门和状态。
3. 在模板 `B1` 填写 `YYYYMM` 工资期间，并填写“公司人力总成本”。
4. 在工资管理页上传模板，系统按人员 ID 精确关联月度快照。

人员离开钉钉可见范围后只会标记为离职，不会删除人员或历史工资。旧版工资表仍可按唯一工号或唯一姓名兼容匹配，但不能自动创建未同步人员。

## 本地运行

```bash
cp .env.example .env.local
npm install
npm run dev
```

本地数据写入 `.data/auto-cost.json`，该目录不会进入 Git。系统不提供账号密码登录；本地联调登录页前，需要在 `.env.local` 配置钉钉应用和登录范围。

## 钉钉扫码登录

在钉钉开发者后台创建企业内部应用，并在“钉钉登录与分享”中配置本地回调地址。扫码登录需要 `Contact.User.Read` 以及根据 unionId 查询企业 userId 的成员读取权限；系统端还会使用 `DINGTALK_ALLOWED_USER_IDS` 校验登录范围。

完整通讯录同步会递归读取部门、分页读取部门成员，需要额外开通以下应用权限：

- `qyapi_get_department_list`：通讯录部门信息读权限。
- `qyapi_get_department_member`：通讯录部门成员信息读权限。

同步范围受钉钉后台配置的通讯录权限范围/应用可见范围限制。如果要同步全公司，必须让该应用的通讯录权限范围覆盖全公司；系统登录权限仍由 `DINGTALK_ALLOWED_USER_IDS` 单独控制。同步不会申请或读取手机号权限。

```text
DINGTALK_CLIENT_ID=<应用 Client ID>
DINGTALK_CLIENT_SECRET=<应用 Client Secret>
DINGTALK_REDIRECT_URI=http://localhost:3000/api/auth/dingtalk/callback
DINGTALK_CORP_ID=<企业 CorpId，可选但建议配置>
DINGTALK_ALLOWED_USER_IDS=* # 本企业当前有效成员均可登录；也可填写逗号分隔的指定 userId
```

开发者后台的重定向 URL 必须与 `DINGTALK_REDIRECT_URI` 所使用的本地域名和端口一致。钉钉官方网页登录流程支持 `http://localhost` 用于开发测试。应用凭据与登录范围只写入 `.env.local`，不得提交到代码仓库。

## 生产环境

Vercel Marketplace 安装 Neon 后会自动注入唯一必需的生产变量：

```text
DATABASE_URL=<Neon Postgres 连接串>
```

生产系统仅允许钉钉扫码登录，没有固定账号或密码回退入口。建议配置独立 `AUTH_SECRET`；未配置时，生产环境使用 `DATABASE_URL` 经域隔离 SHA-256 派生会话签名密钥，数据库凭据轮换会使已有会话失效。

生产环境未连接 Neon 时应用会拒绝读取或写入工资数据，不会降级到 Vercel 临时文件系统。
新数据仓库从空人员、空工资状态开始；历史版本遗留的演示人员及对应演示成本会被自动清理，真实人员、离职人员和月度工资快照不受影响。

## 验证

```bash
npm test
npm run lint
npm run typecheck
npm run build
PAYROLL_TEST_FILE=/absolute/path/to/2607工资.xlsx npm run test:e2e
```

详细设计和验收基线见 [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md) 与 [`docs/ACCEPTANCE_CRITERIA.md`](docs/ACCEPTANCE_CRITERIA.md)。
