---
title: 用 WebHID 测试键鼠协议指令
published: 2026-11-23
description: 从授权设备、核对 Report 通道，到解读回包和验证实际效果，走完一次 WebHID 指令测试。
category: WebHID
tags: [WebHID, 工具使用]
pinned: true
updated: 2026-11-25
readingGuide:
  audience: 正在开发键鼠网页驱动、需要按协议验证指令的开发者。
  preparation:
    - 支持 WebHID 的 Chrome 或 Edge，以及可授权的 HID 设备。
    - 目标设备的协议资料，包含 Report ID、长度和报文格式。
  outcome: 能区分 API 调用成功、收到响应与设备实际生效，并逐项核验。
comment: false
---
键鼠设备的网页配置工具，需要把界面上的操作转换成设备能识别的协议数据。为了方便测试指令，我整理了一个可以直接在浏览器中使用的 HID 调试工具。

[打开 WebHID 调试工具 →](/tools/hid/)

## 先看完整流程

::::steps
:::step[连接并确认设备]
先确认授权的是哪一个设备和接口，再开始构造数据。[查看连接说明](#1-连接设备)。
:::
:::step[选择指令与通道]
根据协议选择 Report 类型，核对 ID、长度和字段。[查看通道说明](#2-选择指令与通道)。
:::
:::step[核对返回数据]
把响应与当前指令对应起来，检查长度、状态和数据内容。[查看回包判断](#3-怎样看待返回数据)。
:::
:::step[验证实际效果]
通过实际操作、配置读回或重新连接，确认设备上的结果。[查看验证方法](#4-验证实际效果)。
:::
::::

## 1. 连接设备

在支持 WebHID 的 Chrome 或 Edge 中打开工具，点击“授权设备”，再从浏览器的授权窗口选择目标设备。

授权后，先核对设备名称、VID 和 PID。同一台设备可能暴露多个 HID 接口，能在列表里看到设备，并不代表已经选中了协议使用的那个接口。需要结合协议和设备描述信息确认。

## 2. 选择指令与通道

工具提供协议预设，也支持输入自定义十六进制数据。实际发送前，需要核对 Report ID、长度、命令字、地址字段及校验方式，具体格式以固件方案商提供的协议为准。

WebHID 中有不同的数据通道。例如，Feature Report 可以使用下面两个 API 发送和读取；Output Report 则使用 `sendReport`，Input Report 通过 `inputreport` 事件接收。

~~~ts
await device.sendFeatureReport(reportId, bytes);
const response = await device.receiveFeatureReport(reportId);
~~~

这里的 `reportId` 独立于数据参数。上面的代码只是 API 使用示意，不能代替某款设备的完整协议流程；也不是所有设备都使用 Feature Report 通信。

## 3. 怎样看待返回数据

发送成功只能说明这一次 API 调用没有报错。收到数据后，还要判断它是不是当前指令对应的响应，而不是其他事件的上报。

可以先检查报文长度、命令字、地址或序号，再对照协议解读状态字段和数据内容。如果协议没有给出足够的关联字段，就需要结合通信顺序和实际设备行为进一步判断。

## 4. 验证实际效果

以改键为例，我会通过实际按键或点击鼠标，观察输出是否符合预期。协议支持时，也可以读取配置进行核对。

“发出指令”“收到响应”“读回正确配置”和“设备实际生效”是不同的验证环节。如果功能涉及保存到设备，还需要另外确认保存流程和重新连接后的表现。

工具负责让数据更容易观察；判断通信和功能是否正确，仍然需要协议资料与实际验证。

## 配合其他工具一起使用

如果需要观察原网页的一次操作，可以使用 [WebHID 抓包脚本](/tools/webhid-workbench/)，按操作捕获快照并导出 JSON。它适合观察已有网页；本工具适合按协议手动构造和测试指令。

具体记录方式可以看[抓包脚本使用记录](/posts/webhid-workbench/)。涉及键盘页面上的位置与尺寸调整，则可以看 [RK 键位对齐工具](/posts/rk-key-align/)。

## 参考资料

WebHID 的授权、报告类型和 API 用法可查阅 [Chrome WebHID 文档](https://developer.chrome.com/docs/capabilities/hid)。
