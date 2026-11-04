# 页面写入合同

1. 读取当前页面上下文 importPreview.period 与 importPreview.scope；period.end 为不含的结束日。必须使用原样周期，不把本周和月累计混用。优先读取动作目录 report:import-scope 的授权基地说明；上下文 scope.bases 可能被裁剪为样本，不能把样本当完整授权列表。使用用户明确指定的基地生成预览，服务端按完整授权集合校验；拒权时停止，不改写成别的基地。濮阳不进入基地卡片。
2. 使用实际可用的页面动作工具，先读目录。目标 report:import-preview，kind=invoke，action=preview，value 为下述 JSON 的字符串。此步骤不保存业务内容。不臆造工具名。
3. 预览成功后页面自动打开“工作台内容填充预览”弹窗。读取更新后的 importPreview：previewId、canCommit、counts、status、awaitingUserConfirmation。confirmationMode=dialog-only；canCommit 只表示内容校验通过，不表示 Agent 有提交权限。
4. Agent 到此停止，提示用户在弹窗点击“确认导入”或“取消”。即使用户在聊天中授权或回复确认，也不得调用提交动作或代点确认按钮；目录不提供 report:import-commit 是预期行为，不代表保存功能缺失。用户点击确认后，页面核对周期和版本并实际保存；取消、关闭或 Escape 会清除待导入预览，不写入。
5. 用户操作后可只读查询 importPreview.status 核验结果：数据库成功回执才可说已保存；等待确认、预览和 pending 均不算保存。失败或超时不宣称成功，保持逻辑批次重试并重新由用户在弹窗确认。

## JSON 结构

所有未知字段均被拒绝，不传 SQL、指标值、权限或 HTML。schemaVersion=1；batchId 是 8–80 位字母数字、下划线、连字符，代表同一来源同一周期的逻辑批次，更新时保持不变。相同内容重复提交不新增；同批新内容保留历史、只展示最新版本。每批最多 50 条明细、60KB；超限明确拆批，不能丢弃。

- period: {type,start,end}，原样取当前页面上下文。
- source: {kind,name,sha256?}。真实文件 kind=file，必须提供真实文件 SHA256；明确用户文本 kind=message；示例 kind=example 不允许提交。
- summary: {positive?,risk?,rhythm?}。值为有依据的文本；不提供的字段省略。人工维护的摘要保留；有人工内容时，导入摘要在同一区域的“补充结论”中显示，核验时同时读取 supplementalSummary，不把保留人工内容误判为未保存。
- unmet: [{key,base,source:{sheet,row},dimension,entity,reason,measure}]。dimension 仅 base/item/director，base 维度 entity 必须等于 base。每条须有实际工作表与从 1 开始行号；明确文本可用 sheet=当前对话、row=段落序号。
- short: [{key,base,source:{sheet,row},direction,measure,issue}]。
- long: [{key,base,source:{sheet,row},mechanism,content,goal,status}]。

每类数组内 key 稳定且唯一，更新同一行时复用。空数组可以省略。普通文本最多 1600 字，实体和状态最多 120 字。文本不含 HTML 或链接。缺少原因写待核验；缺措施写待制定改善措施，不能伪造已执行状态。溯源只保存在后台；卡片只展示原因和措施。人工修改、删除导入项后按人工结果保留，重复导入不恢复已删内容。
