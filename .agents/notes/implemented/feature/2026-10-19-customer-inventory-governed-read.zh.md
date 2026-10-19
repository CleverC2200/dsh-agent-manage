# Agent Note: Customer inventory governed read

Status: implemented

## Problem

已接收的客户库存页面使用内嵌样例行，能力声明为空。若在页面内增加数据库客户端，会暴露凭据、绕过GEA身份与授权，并重复已有正式库存页面的受控SQL链路。

## Decision

Workbench保留已接收的React/Arco布局，通过共享 `gea-html-v2` SQL通道读取 `agents_scm_cust_jxc_ai_daliy_d` 最新快照及 `agents_dim_dealer_data_d` 的卸货地址成员关系。Manage为 `customer-inventory-preview` 声明两张表和 `governed-sql-read`；身份、凭据、行列授权及执行仍只归GEA Host。

首版映射发布源表库存数量、库存金额、近30日动销、正常库存及零动销SKU数。周转和正常库存占比为页面派生；目标引用经销商侧既有结果，未取得时保持未知，不用20日销量重算。大区、省区来自库存源；卸货城市从经销商地址JSON解析为客户的多值成员关系，单选城市展示相关客户整体库存，城市间不得相加。结构分、大日期/临期、缺货及负责人保持未知。客户字段覆盖不足时保持未知，汇总累加可用值并发布缺失、异常客户数。保留负库存账面值，合计为负时不计算有效周转。原“库存新鲜度”卡片按具有正库存的客户加权正常库存占比，并标出客户覆盖，不代表批次效期已核验。缺失字段不回退到样例。

本决定部分替代[已接收模拟业务资源](2026-10-07-received-mock-business-resources.zh.md)中的客户库存部分；其订单工作台、订单履约及其他接收原型决定继续有效。

## Alternatives considered

**HTML直连Doris。** 这会把凭据与授权判断放进Workbench，违反既有GEA Host边界。

**等所有卡片都有来源后再去掉样例。** 这会掩盖哪些事实已经实时，并让旧演示值被误认为当前库存。

**从相似字段推断缺失风险。** “正常库存”等字段名不能证明大日期、临期或缺货语义；在确认受控来源和业务定义前必须保持未知。

## Consequences

源码和映射测试可在无凭据下验证固定SQL、单位、派生和空值保留。源码完成不证明真实可用；安装、测试环境资源绑定、Consumer授权以及原始 `inspect_cube_model`/SQL回执仍是外部验收证据。当前保留既有consumerCode，避免凭空创造正式身份；GEA必须授权该精确编码，或在批准替代编码后同步更新全部声明。
