# 改单率当前合同

版本：`quantity-shipment-nonnegative-no-lock-v2`。

按 agents_scm_order_trace_final_di.lastshipmenttime（装车完成时间）归属实际发货周期；以执行单号＋客户关联日表，按update_time、load_time最新批次保留并列记录后取最后装车完成时间。缺发货时间不回退OMS新增、WMS关单或预计到货时间。数量来源为`ai_db.agents_scm_execute_detail_d`；时间来源为`ai_db.agents_scm_order_trace_final_di`，结果列为`shipped_at`。日表`wms_close_time`的发布定义仅为WMS关单时间，不把它等同实际发货时间。

按商品明细数量合计，不按订单张数、SKU种类或明细条数计率。有效量=COALESCE(dms_last_update_qty,need_qty_origin,0)；分子仅change_order_qty≥0时合计ABS(change_order_qty－有效量)，0保留，空或负值不计分子；分母保留全部有效明细有效量，三个数量全空剔除。

保留detailstatus=10、is_stat=1，剔除作废，创建来源仅createsource=20，剔除虚拟出1/2与超时原因14/16；按仓库维表两端同提货点且均为工厂仓/外租仓剔除短驳。郑州只筛pickup_point=01。其余条件沿当前看板，不加锁定期、交期或改单时间条件；不额外按SKU发货数量筛选，不将分母改成发货数量。

`gea_order_amendment`参数start包含、endExclusive不包含，均指装车完成日期。汇总和分页明细复用同一固定查询；先列商品数量分子、完整分母和率值，明细展示shipped_at，不用单页代替全量分母。旧创建周期或旧合同结果必须刷新后使用。拒权或缺少发货来源时不换数据表、Consumer或时间字段。

2026年10月范围为shipped_at≥2026-10-01且shipped_at<2026-11-01。装车完成决定归属周期，但当前数量/状态仍可能被上游更新；未接入历史快照，不宣称已冻结历史。

计数字段：records为通过时间和业务过滤后的明细条数；invalid为其中关键字段不足的待判定条数，不是被剔除条数。本查询没有返回剔除数量，不得依据invalid=0声称未剔除订单。
