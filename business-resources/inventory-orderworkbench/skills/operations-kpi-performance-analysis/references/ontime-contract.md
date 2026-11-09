# 准交率当前合同

版本：`execution-arrival-18-12-complete-v1`。

客户类型取 `agents_scm_order_trace_final_di.cust_type`：`LOWER(TRIM(cust_type)) IN ('kamd','dc')` 使用18小时，否则使用12小时。SQL按底表时间值直接比较，不额外转换时区。

当前准交率以看板执行单到货口径为准：按COALESCE(gpsisinraildate_to,arriveconfirm_time)实际到货时间归属周期，执行单号去重，单位张。分子为已确认准交执行单数，分母为全部符合筛选的候选执行单数，待判定保留在分母且不视为已确认逾期。基准为MAX(客户期望到货、开单确认到货、系统计算到货)，kamd/dc晚满18小时、其他客户晚满12小时为逾期，严格早于才准交。系统交期缺失时仅能严格证明早于已有两交期最大值+对应时限的单确认准交，否则待判定。直接报告页面或gea_order_ontime返回的numerator、denominator、pending、known、late和value，不从样本率反推计数。独立查询调用gea_order_ontime，复用看板固定SQL和全部剔除条件，不用旧Cube的fromorderno_month或SUM(is_ontime)/COUNT(is_ontime)替代。

实际到货优先目的地GPS围栏，其次到货确认。实际到货证明已发货，不要求lastshipmenttime非空，也不加OMS新增时间、detailstatus/is_stat条件。按看板belong_base筛选基地；郑州庞丽娟沿用郑州基地准交率。

剔除：两端仓库同提货点且都为工厂仓/工厂外租仓的短驳；海外、国外、港澳大区；未派车；虚拟出库1/2；空车型及铁柜40、铁柜45、无车型要求（常温）、无车型要求（速冻）、自提；超时原因14/16。仓库类型缺失或冲突保留待判定，不自行推断正常。

`gea_order_ontime` 参数为start（含）、endExclusive（不含）、base、view（summary/details）、page（1起）。summary为全量计数；details每页200张，不用一页计算总率。分母0时率未知；拒权、失败或字段缺失不补零、不换旧Cube，不把样本率当作当前率。
