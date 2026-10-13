/* ============================================
I18N - Bilingual Support (English / 中文)
============================================ */

const I18N = {
zh: {
'landing.title': '检验门户',
'landing.subtitle': '质量检验数字化系统 · 私人内部使用',
'landing.footer': 'v1.0 · 生产质检系统',
'status.storage': '存储状态：',
'role.bteam.name': 'Get Start',
'role.bteam.desc': '现场拍照 · 上传照片 · 记录数据',

'role.customer.name': 'Customer List',
'role.customer.desc': '查看报告 · 下载PDF · 评论反馈',
'common.back': '返回', 'common.next': '下一步', 'common.previous': '上一步',

'common.loading': '加载中...',

'common.submit': '提交','common.pending': '待处理',

'common.home': '首页',

'bteam.start_new': '开始新检验', 'bteam.session': '检验单',
'bteam.unfinished_drafts': '未完成的草稿', 'bteam.save_continue': '保存并继续',
'submit.confirm_title': '确认要提交吗？', 'submit.confirm_note': '提交后将不能再修改这份检验单。', 'submit.yes': '是，提交', 'submit.no': '否，返回',
'submit.photos': '照片数量', 'submit.done': '提交成功', 'submit.failed': '提交失败，没有提交任何内容，请重试。',
'bteam.step.setup': '基本信息', 'bteam.step.photos': '拍照上传',
'bteam.step.measurements': '尺寸测量', 'bteam.step.submit': '提交',
'bteam.step_of': '第 {n} 步 / 共 {total} 步', 'bteam.submit_title': '提交检验',
'photo.hint': '支持 JPG, PNG，每张最大 5MB',
'form.timestamp': '提交时间',
'form.customer': '客户代码 (Customer Code)', 'form.customer.placeholder': 'e.g. NO1',
'form.inspection_date': '检验日期', 'form.date_invalid': '请输入正确的日期，格式：日/月/年，例如 16/10/2026',
'form.pi': 'PI 单号 (Proforma Invoice)', 'form.pi.placeholder': 'e.g. PI001',
'form.batch': '批次', 'form.batch.placeholder': '例如：B001',
'form.model': '型号', 'form.model.placeholder': '例如：EEI-7672',
'form.version': '版本', 'form.version.placeholder': 'e.g. 001',
'form.inspection_by': '检验人 (Inspection by)', 'form.po_no': 'PO 号 / 订单号 (PO No / Order No)',
'form.total_qty': '总数量 (Total Quantity)', 'form.sample_size': '抽样数量 (Sample size)',
'form.color': '颜色', 'form.color.placeholder': 'e.g. PO 12345',
'form.box_count': '箱数', 'form.type': '检验类型',
'form.type.psi': 'PSI 生产检验', 'form.type.sample': 'Sample 样品检验',

'form.supplier': '供应商 (Supplier)',

'photo.title': '照片采集',
'photo.take_photo': '拍照', 'photo.upload': '从相册选择',
'photo.delete': '删除照片', 'photo.delete_confirm': '确定删除这张照片？',
'photo.no_photos': '暂无照片',

'measure.title': '尺寸测量', 'measure.subtitle': '将照片拖拽到对应分类',
'measure.uploaded_photos': '已上传照片', 'measure.box': '箱',
'measure.gross_weight': '毛重 Gross Weight (kg)', 'measure.net_weight': '净重 Net Weight (kg)', 'measure.result': '结果', 'measure.pass': '合格 (Pass)', 'measure.fail': '不合格 (Fail)',
'measure.add_item': '添加项目', 'measure.custom_title_ph': '标题，例如：anmo test', 'measure.remove_item_confirm': '删除这个项目吗？里面的照片会回到“已上传照片”。',
'measure.detail_placeholder': '填写备注...',
'measure.dim.length': '长 Length (mm)', 'measure.dim.height': '高 Height (mm)', 'measure.dim.width': '宽 Width (mm)',

'report.title': '检验报告',

'report.download_pdf': '下载 PDF',

'customer.title': '客户列表', 'customer.subtitle': '查看报告 · 判定 Pass / Fail',
'customer.feedback': '反馈', 'customer.tab.psi': 'PSI - Production', 'customer.tab.sample': 'Sample', 'customer.tab.pending': '待完成',
'customer.submitted_on': '提交日期：{date}', 'customer.updated_on': '最后修改：{date}', 'customer.untitled': '(未填写客户代码)',
'customer.result_unset': '未判定', 'customer.result_hint': '选择 Pass / Fail 后才能下载 PDF', 'customer.close': '关闭', 'customer.view_report': '查看报告',


'msg.no_data': '暂无数据',

},
en: {
'landing.title': 'Inspection Portal',
'landing.subtitle': 'Digital Quality Inspection System · Private Use',
'landing.footer': 'v1.0 · Production QC System',
'status.storage': 'Storage:',
'role.bteam.name': 'Get Start', 'role.bteam.desc': 'On-site photos · Upload · Data entry',

'role.customer.name': 'Customer List', 'role.customer.desc': 'View reports · Download PDF · Feedback',
'common.back': 'Back', 'common.next': 'Next', 'common.previous': 'Previous',

'common.loading': 'Loading...',

'common.submit': 'Submit','common.pending': 'Pending',

'common.home': 'Home',

'bteam.start_new': 'Start New Inspection', 'bteam.session': 'Inspection',
'bteam.unfinished_drafts': 'Unfinished Drafts', 'bteam.save_continue': 'Save & Continue',
'submit.confirm_title': 'Are you sure you want to submit?', 'submit.confirm_note': 'Once submitted, this file can no longer be edited.', 'submit.yes': 'Yes, submit', 'submit.no': 'No, go back',
'submit.photos': 'Photos', 'submit.done': 'Submitted successfully.', 'submit.failed': 'Submit failed. Nothing was submitted - please try again.',
'bteam.step.setup': 'Basic Info', 'bteam.step.photos': 'Photos',
'bteam.step.measurements': 'Measurements', 'bteam.step.submit': 'Submit',
'bteam.step_of': 'Step {n} of {total}', 'bteam.submit_title': 'Submit Inspection',
'photo.hint': 'JPG, PNG supported, max 5MB per photo',
'form.timestamp': 'Timestamp',
'form.customer': 'Customer Code', 'form.customer.placeholder': 'e.g. NO1',
'form.inspection_date': 'Inspection Date', 'form.date_invalid': 'Enter a valid date as DD/MM/YYYY, e.g. 16/10/2026',
'form.pi': 'PI Number', 'form.pi.placeholder': 'e.g. PI001',
'form.batch': 'Batch', 'form.batch.placeholder': 'e.g. B001',
'form.model': 'Model', 'form.model.placeholder': 'e.g. EEI-7672',
'form.version': 'Version', 'form.version.placeholder': 'e.g. 001',
'form.inspection_by': 'Inspection By', 'form.po_no': 'PO No / Order No',
'form.total_qty': 'Total Quantity', 'form.sample_size': 'Sample Size',
'form.color': 'Color', 'form.color.placeholder': 'e.g. PO 12345',
'form.box_count': 'Box Count', 'form.type': 'Inspection Type',
'form.type.psi': 'PSI - Production', 'form.type.sample': 'Sample',

'form.supplier': 'Supplier',

'photo.title': 'Photo Capture',
'photo.take_photo': 'Take Photo', 'photo.upload': 'Choose from Gallery',
'photo.delete': 'Delete Photo', 'photo.delete_confirm': 'Delete this photo?',
'photo.no_photos': 'No photos yet',

'measure.title': 'Measurements', 'measure.subtitle': 'Drag photos into the matching category',
'measure.uploaded_photos': 'Uploaded Photos', 'measure.box': 'Box',
'measure.gross_weight': 'Gross Weight (kg)', 'measure.net_weight': 'Net Weight (kg)', 'measure.result': 'Result', 'measure.pass': 'Pass', 'measure.fail': 'Fail',
'measure.add_item': 'Add item', 'measure.custom_title_ph': 'Title, e.g. anmo test', 'measure.remove_item_confirm': 'Remove this item? Its photos go back to the uploaded photos.',
'measure.detail_placeholder': 'Add notes...',
'measure.dim.length': 'Length (mm)', 'measure.dim.height': 'Height (mm)', 'measure.dim.width': 'Width (mm)',

'report.title': 'Inspection Report',

'report.download_pdf': 'Download PDF',

'customer.title': 'Customer List', 'customer.subtitle': 'View reports · Mark Pass / Fail',
'customer.feedback': 'Feedback', 'customer.tab.psi': 'PSI - Production', 'customer.tab.sample': 'Sample', 'customer.tab.pending': 'Pending',
'customer.submitted_on': 'Submitted: {date}', 'customer.updated_on': 'Last edited: {date}', 'customer.untitled': '(No customer code)',
'customer.result_unset': 'Not set', 'customer.result_hint': 'Choose Pass / Fail before downloading the PDF', 'customer.close': 'Close', 'customer.view_report': 'View Report',

'msg.no_data': 'No data',

}
};

const I18nManager = {
current: 'zh',
init() {
const saved = localStorage.getItem('lang');
if (saved && I18N[saved]) this.current = saved;
this.apply();
this.bindSwitcher();
},
setLang(lang) {
if (!I18N[lang]) return;
this.current = lang;
localStorage.setItem('lang', lang);
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
this.apply();
},
t(key, params) {
let text = I18N[this.current][key] || I18N['en'][key] || key;
if (params) { Object.keys(params).forEach(k => { text = text.replace(`{${k}}`, params[k]); }); }
return text;
},
apply() {
document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.getAttribute('data-i18n')); });
document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = this.t(el.getAttribute('data-i18n-placeholder')); });
document.querySelectorAll('.lang-btn').forEach(btn => { btn.classList.toggle('active', btn.dataset.lang === this.current); });
document.documentElement.lang = this.current === 'zh' ? 'zh-CN' : 'en';
},
bindSwitcher() {
document.querySelectorAll('.lang-btn').forEach(btn => { btn.addEventListener('click', () => this.setLang(btn.dataset.lang)); });
}
};

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', () => I18nManager.init());
} else { I18nManager.init(); }

window.I18n = I18nManager;
window.t = (key, params) => I18nManager.t(key, params);
