# Auto Cost 技术规格（V1）

状态：开发基线  
版本：1.0  
日期：2026-08-26  
负责人：Heils 财务系统项目组

## 1. 项目目标

Auto Cost 是独立的人力成本管理与查询系统，为公司经营分析系统提供受控的人力成本汇总数据。系统隔离保存工资数据，只允许财务人员访问，不向第三方返回个人成本。

V1 是环境测试版本：使用固定账号登录，完成工资 Excel 导入、工资管理、人员管理、仪表盘、接口密钥管理、聚合查询、查询日志和操作审计。钉钉真实扫码登录及真实通讯录同步保留适配接口，待提供企业应用凭据后启用。

## 2. 已冻结业务口径

1. 第三方接口只返回整批总额，不返回逐人金额。
2. 每次查询至少包含 2 名有效人员。
3. 月度成本按自然日分摊。
4. 日期范围为闭区间，开始日与结束日均计入。
5. 时区固定为 `Asia/Shanghai`，币种固定为 `CNY`。
6. 跨月时按月拆分计算，最终汇总后四舍五入到 2 位小数。
7. 工资页面月份按倒序排列，最近月份靠左。
8. Excel 只提取姓名、月份、公司人力总成本；部门由人员资料关联并保存月度快照。
9. 原始 Excel 默认不持久化，只保留文件名、SHA-256、导入统计和审计信息。

## 3. 技术架构

- 框架：Next.js 16 App Router、React 19、TypeScript。
- 页面读取：React Server Components 直接读取服务端数据。
- 页面写操作：Server Actions 或受认证的内部 Route Handlers。
- 第三方接口：Next.js Route Handler，路径 `/api/v1/labor-cost/query`。
- Runtime：Node.js，支持 Excel 解析、加密和数据库访问。
- 本地开发：文件型开发仓库，仅保存于 `.data/`，不提交 Git。
- 生产环境：Neon PostgreSQL，通过 `DATABASE_URL` 使用；未配置数据库时禁止生产写入。
- Excel 解析：SheetJS `xlsx`，只读取第一个工作表。
- 金额：数据库 decimal 语义；应用内部以“分”为整数保存和累计，避免浮点误差。
- 部署：Vercel，开发、预览、生产环境变量隔离。

## 4. 路由和页面

| 路由 | 功能 | 权限 |
| --- | --- | --- |
| `/login` | 固定账号登录 | 公开 |
| `/dashboard` | 月、季、年指标及趋势、部门分布 | 已登录财务人员 |
| `/payroll` | 月份列式工资表、导入、编辑 | 已登录财务人员 |
| `/people` | 人员目录、同步状态、在离职状态 | 已登录财务人员 |
| `/integrations` | API 密钥、请求示例、查询日志 | 已登录财务人员 |
| `/audit` | 导入、修改、登录、密钥等审计事件 | 已登录财务人员 |

根路径 `/` 根据登录状态跳转到 `/dashboard` 或 `/login`。

## 5. 身份认证

### 5.1 V1 固定账号

- 默认测试账号：`admin`。
- 默认测试密码：`admin123`。
- V1 环境测试固定账号为 `admin / admin123`；可通过 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 成对覆盖。
- `AUTH_SECRET` 用于 HMAC-SHA256 签名会话 Cookie；未配置时，生产环境通过 `DATABASE_URL` 做域隔离 SHA-256 派生，数据库凭据轮换会使已有会话失效。
- Cookie 属性：HttpOnly、SameSite=Lax、生产环境 Secure、8 小时过期。
- 登录失败采用来源 IP + 用户名的内存限流；审计只记录用户名、来源和结果，不记录密码。

### 5.2 钉钉扫码登录

- 使用企业内部应用 OAuth 2.0 网页授权，授权入口为 `/api/auth/dingtalk`，回调为 `/api/auth/dingtalk/callback`。
- OAuth `state` 使用 256 位随机数并通过 HttpOnly、SameSite=Lax、10 分钟有效期 Cookie 绑定，回调后立即清除，防止登录 CSRF 与重放。
- 服务端以授权码换取用户访问凭证，读取 `unionId`，再通过企业应用凭证换取组织 AccessToken，并将 `unionId` 映射为企业 `userId`。
- 登录采用双重权限控制：钉钉应用权限范围控制可读取的组织数据；系统端 `DINGTALK_ALLOWED_USER_IDS` 单独限制可登录的财务人员。
- 扫码登录需要 `Contact.User.Read` 和 unionId 到企业 userId 的成员读取权限；不申请手机号权限，不读取手机号。
- 钉钉身份会写入现有 8 小时签名会话 Cookie，Cookie 中仅保存姓名、认证来源和钉钉 `userId`，不保存钉钉 AccessToken。
- 固定账号在本地环境继续作为故障回退；正式开放前必须更换或移除。

### 5.3 钉钉通讯录同步

- 使用应用 AccessToken 调用 `topapi/v2/department/listsub`，从根部门开始递归读取部门树；AccessToken 按服务端返回有效期缓存并预留 60 秒过期缓冲。
- 对每个部门调用 `topapi/v2/user/list`，每页最多 100 人并按游标读取完整结果，按钉钉 userId 去重；部门与成员请求使用最多 6 路受控并发。
- 需要 `qyapi_get_department_list` 和 `qyapi_get_department_member` 两项应用权限；同步范围以钉钉后台配置的通讯录权限范围为准。
- 人员关联顺序为：钉钉 userId、唯一工号、唯一姓名。关联后保留系统人员 ID，避免工资历史断链。
- 本次结果中缺失的既有钉钉人员标记为 `inactive`，不物理删除人员或工资历史。
- 首次获得非空真实通讯录后清除演示人员及其演示成本；不影响 Excel 导入或真实工资历史。
- 每次成功或失败同步都写入审计日志，不记录 AccessToken、Client Secret 或手机号。
- 手动同步路由声明最长 300 秒执行时间，以覆盖大型组织的完整分页读取。

## 6. 数据实体

### Employee

- `id`：系统人员 ID，第三方接口使用。
- `dingtalkUserId`：钉钉唯一标识，可为空。
- `employeeNo`：工号，可为空。
- `name`：姓名。
- `department`：当前部门。
- `status`：`active` / `inactive`。
- `source`：`dingtalk` / `excel` / `demo`。
- `lastSyncedAt`。

### MonthlyCost

- `employeeId`。
- `employeeNameSnapshot`。
- `departmentSnapshot`。
- `period`：`YYYY-MM`。
- `amountCents`：月度公司人力总成本，整数分。
- `version`。
- `updatedBy`、`updatedAt`。
- 唯一键：`employeeId + period`。

### PayrollImport

- 文件名、SHA-256、月份。
- 总行数、有效行数、错误行数。
- 状态：`previewed` / `committed` / `failed`。
- 操作人、时间。

### ApiClient

- 名称、密钥前缀、密钥 SHA-256 摘要、末四位。
- 状态、创建时间、最后使用时间。
- 完整密钥只在创建时返回一次。

### QueryLog

- 请求编号、来源系统、来源 IP、User-Agent。
- 人员数、总自然日数、请求摘要。
- 成功/失败、错误码、中文原因。
- 成功时保存整批汇总金额，不保存逐人成本。
- 响应耗时、时间。

### AuditEvent

- 操作者、动作、对象类型、对象 ID。
- 变更摘要；工资修改保存修改前后金额与原因。
- 来源 IP、时间。

## 7. Excel 导入

人员管理页面提供系统工资模板下载。模板从数据库读取全部在册及历史人员，写入稳定人员 ID、工号、姓名、部门和在离职状态；工资期间和公司人力总成本由财务填写。模板第一工作表结构为：

- `B1`：工资期间，例如 `202607`。
- `A:F`：人员 ID、工号、姓名、部门、人员状态、公司人力总成本。

导入规则：

1. 只接受 `.xlsx`，最大 10 MB。
2. 只读取第一个工作表。
3. 期间必须能够标准化为 `YYYY-MM`，一个文件只允许一个期间。
4. 系统模板按人员 ID 精确匹配；旧版工资表仅兼容唯一工号、唯一姓名匹配。
5. 未匹配、同名歧义、重复工号或重复人员均报错，工资导入不能自动新建人员。
6. 在职人员成本必须是有限数值且不小于 0；公式错误、空白和非数值必须报错，不能转换为 0。
7. 离职人员保留在模板和数据库中，本月无成本时可留空，有离职结算时仍可填写。
8. 预览返回有效行、错误行、月份和文件摘要；存在错误时不允许提交。
9. 提交采用批次原子写入，同一人员同一月份执行带审计的更新；月度记录保存当时姓名和部门快照。
10. 相同文件 SHA-256 重复提交时提示并拒绝。

## 8. 人力成本计算

单人在一个月内的成本：

```text
monthlyCost × overlapCalendarDays / daysInMonth
```

跨月请求拆成多个月份段。应用内部使用整数分和有理数累计，在最终整批结果处四舍五入到分。

有效人员必须同时满足：

1. `employeeId` 存在且人员互不重复。
2. `from <= to`，并至少覆盖 1 个自然日。
3. 范围不超过 366 天，不允许未来日期。
4. 覆盖的每个月都有工资数据。
5. 分摊成本大于 0。

整批有效人员少于 2 时拒绝。任一人员成本贡献低于整批总额的 10% 时拒绝，错误码 `CONTRIBUTION_TOO_LOW`。

## 9. 第三方 API

请求：

```http
POST /api/v1/labor-cost/query
Authorization: Bearer <security-string>
Content-Type: application/json
```

```json
{
  "items": [
    { "employeeId": "emp_001", "from": "2026-07-01", "to": "2026-07-15" },
    { "employeeId": "emp_002", "from": "2026-07-05", "to": "2026-07-20" }
  ]
}
```

成功只返回：

```json
{
  "requestId": "req_xxx",
  "success": true,
  "participantCount": 2,
  "allocationMethod": "calendar_day",
  "currency": "CNY",
  "totalCost": 56820.35
}
```

错误码至少包括：

- `UNAUTHORIZED`
- `INVALID_JSON`
- `INVALID_DATE_RANGE`
- `DUPLICATE_EMPLOYEE`
- `MIN_PARTICIPANTS`
- `EMPLOYEE_NOT_FOUND`
- `MISSING_MONTHLY_COST`
- `ZERO_CONTRIBUTION`
- `CONTRIBUTION_TOO_LOW`
- `DIFFERENCING_RISK`
- `RATE_LIMITED`

不得在响应或运行日志中返回逐人成本。

## 10. 防推断与密钥安全

- API 密钥使用高熵随机值，格式 `ac_live_...`。
- 数据库只保存 SHA-256 摘要和展示用前后缀。
- 至少 2 名有效人员，且每名贡献不少于整批 10%。
- 请求指纹由调用方、排序后的人员与时间范围生成。
- 拒绝同一调用方短时间内仅增删一个人员、或只修改一个人员时间范围的高度相似请求。
- 对密钥进行分钟级限流；V1 单实例使用内存限流，生产升级为共享限流存储。
- 日志保存脱敏后的请求摘要，不保存明文密钥。

## 11. 页面交互要求

- 桌面端优先，1280px 及以上完整展示；移动端导航可折叠。
- 视觉风格为浅色、简洁、企业级，不使用强烈 AI 光效。
- 所有表单都有 label、键盘焦点和明确错误信息。
- 工资金额默认仅在财务登录态内出现。
- 加载、空状态、错误状态均有明确反馈。
- 手工修改成本时必须填写修改原因。

## 12. 环境变量

```text
DATABASE_URL=
ADMIN_USERNAME=        # 可选，必须与 ADMIN_PASSWORD 同时配置
ADMIN_PASSWORD=        # 可选
AUTH_SECRET=           # 可选，建议正式开放前独立配置
DATA_BACKEND=local|neon # 本地可选；生产存在 DATABASE_URL 时自动使用 Neon
DINGTALK_CLIENT_ID=     # 企业内部应用 Client ID
DINGTALK_CLIENT_SECRET= # 企业内部应用 Client Secret，仅服务端
DINGTALK_REDIRECT_URI=  # 例如 http://localhost:3000/api/auth/dingtalk/callback
DINGTALK_CORP_ID=       # 可选但建议配置，用于校验登录组织
DINGTALK_ALLOWED_USER_IDS= # 财务人员钉钉 userId，英文逗号分隔
```

秘密变量不能使用 `NEXT_PUBLIC_` 前缀。预览环境不得连接生产工资数据库。

## 13. 非目标与后续版本

V1 不包含：

- 钉钉通讯录定时自动同步（当前为财务人员手动触发真实全量同步）。
- 多角色细分和审批流。
- 原始 Excel 长期归档。
- 差分隐私噪声算法。
- 真实共享 Redis 限流。

以上能力在用户完成 V1 手动验收后进入正式版计划。
