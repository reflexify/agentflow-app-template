export type Lang = 'en' | 'vi';
export const initialLang = (): Lang => (navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en');
export const TEXT = {
  en: {
    inbox: 'Inbox', records: 'Records', start: 'Start a case', back: '← Inbox', signOut: 'Sign out', urgentOnly: 'Urgent only',
    startForm: {
      heading: 'Start a case',
      intro: 'Describe the case. Once it is opened, a review task appears in your inbox.',
      summary: 'Summary', summaryPlaceholder: 'e.g. Refund for order 1042', optional: '(optional)', amount: 'Amount',
      summaryMissing: 'Enter a summary for the case.', amountInvalid: 'Enter the amount as a number.',
      submit: 'Start', starting: 'Starting…',
      failed: "The case couldn't be started. Try again in a moment.",
    },
    started: 'Case started. Its first task will appear in your inbox.',
    failed: "Case desk couldn't load your session from AgentFlow. Reload the page to try again.",
    noConfig: "Case desk can't load its configuration.",
    notConfigured: (name: string) => `Not configured: set ${name} in .env and restart Case desk.`,
    refused: {
      APP_NOT_ASSIGNED: "You're not in this app's audience. Ask an AgentFlow admin to add you under Apps.",
      APP_NOT_INSTALLED: 'Case desk is not installed, or was turned off, in your organization.',
      USER_NOT_PROJECTED: "Your AgentFlow account isn't set up in this organization yet. Sign in to AgentFlow once, then try again.",
      other: (code: string) => `Sign-in did not complete (${code}).`,
      unnamed: 'Sign-in did not complete.',
    },
  },
  vi: {
    inbox: 'Hộp việc', records: 'Bản ghi', start: 'Mở hồ sơ', back: '← Hộp việc', signOut: 'Đăng xuất', urgentOnly: 'Chỉ hồ sơ khẩn',
    startForm: {
      heading: 'Mở hồ sơ',
      intro: 'Mô tả hồ sơ. Khi hồ sơ được mở, một công việc duyệt sẽ xuất hiện trong hộp việc của bạn.',
      summary: 'Tóm tắt', summaryPlaceholder: 'VD: Hoàn tiền đơn hàng 1042', optional: '(không bắt buộc)', amount: 'Số tiền',
      summaryMissing: 'Hãy nhập tóm tắt cho hồ sơ.', amountInvalid: 'Hãy nhập số tiền bằng chữ số.',
      submit: 'Bắt đầu', starting: 'Đang mở…',
      failed: 'Không mở được hồ sơ. Hãy thử lại sau ít phút.',
    },
    started: 'Đã mở hồ sơ. Công việc đầu tiên sẽ xuất hiện trong hộp việc.',
    failed: 'Case desk không tải được phiên làm việc từ AgentFlow. Hãy tải lại trang để thử lại.',
    noConfig: 'Case desk không tải được cấu hình.',
    notConfigured: (name: string) => `Chưa cấu hình: đặt ${name} trong .env rồi khởi động lại Case desk.`,
    refused: {
      APP_NOT_ASSIGNED: 'Bạn không thuộc nhóm người dùng của ứng dụng này. Hãy nhờ quản trị viên AgentFlow thêm bạn trong mục Ứng dụng.',
      APP_NOT_INSTALLED: 'Case desk chưa được cài đặt, hoặc đã bị tắt, trong tổ chức của bạn.',
      USER_NOT_PROJECTED: 'Tài khoản AgentFlow của bạn chưa có trong tổ chức này. Hãy đăng nhập AgentFlow một lần rồi thử lại.',
      other: (code: string) => `Đăng nhập chưa hoàn tất (${code}).`,
      unnamed: 'Đăng nhập chưa hoàn tất.',
    },
  },
} as const;
