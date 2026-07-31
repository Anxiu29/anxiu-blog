/// <reference types="vite/client" />

interface HIDDeviceFilter {
  vendorId?: number
  productId?: number
  usagePage?: number
  usage?: number
}

interface HIDDeviceRequestOptions {
  filters: HIDDeviceFilter[]
  optionalFilters?: HIDDeviceFilter[]
}

interface HIDReportItem {
  reportId?: number
  items?: unknown[]
}

interface HIDCollectionInfo {
  usagePage?: number
  usage?: number
  type?: number
  children?: HIDCollectionInfo[]
  inputReports?: HIDReportItem[]
  outputReports?: HIDReportItem[]
  featureReports?: HIDReportItem[]
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice
  readonly reportId: number
  readonly data: DataView
}

interface HIDDevice extends EventTarget {
  opened: boolean
  vendorId: number
  productId: number
  productName: string
  collections: HIDCollectionInfo[]
  open(): Promise<void>
  close(): Promise<void>
  sendReport(reportId: number, data: BufferSource): Promise<void>
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>
  receiveFeatureReport(reportId: number): Promise<DataView>
  addEventListener(
    type: 'inputreport',
    listener: (ev: HIDInputReportEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: 'inputreport',
    listener: (ev: HIDInputReportEvent) => void,
    options?: boolean | EventListenerOptions,
  ): void
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>
  requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>
}

interface Navigator {
  readonly hid: HID
}
