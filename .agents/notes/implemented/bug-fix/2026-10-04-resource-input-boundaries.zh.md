# Agent Note: 资源选用正文限额与逐 Skill 元数据隔离

Status: implemented

## Problem

资源选用 Fetch 路由继承了宿主更大的正文上限，合法资源 id 后补超过64KiB空白仍会进入选用。严格 YAML 解析又位于单个 Skill 的异常边界之外，一个坏 header 会撤掉同提供器里的健康资源。

## Decision

路由使用 streaming Fetch，在解析及选用前按字节计数，与已有 node:http 写路由共用64KiB策略；超限返回413，chunked请求同样受限，不修改宿主全局限额。

集中一个 Skill 元数据判定处理严格 YAML、身份规范化和禁用状态。清单与正文读取都在该资源单元捕获错误、记录具名诊断并关闭该项；查找取消仍抛出，卸载与代际判定继续保留。

## Alternatives considered

**仅用宿主上限或 Content-Length**不能落实更小的本仓写入边界，也不能覆盖chunked及不准确长度。

**在整个提供器层捕获**会隐藏健康 Skill；**清单与正文各写解析**会使缓存candidate绕过相同判定。

## Consequences

[已选业务资源](../feature/2026-10-04-selected-business-resources.zh.md)的interface保持。分配量在本路由受限，原资源文件及persona/Skill原文不重写。公开路由回归覆盖空白padding、chunked、精确边界和未触发选用；提供器回归覆盖坏项与健康项并存、缓存正文变坏及取消。
