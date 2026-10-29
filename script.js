const translations = {
  en: {
    "meta.title": "Dachuan Song | AI Research & Engineering",
    "meta.description":
      "Dachuan Song, Ph.D. student at George Mason University. First-author NeurIPS 2026 research on state-space models, long-context memory and retrieval, and efficient inference.",
    "language.button": "中文",
    "language.aria": "Switch to Chinese",
    "easterEgg.coinLabel": "Hidden contact easter egg",
    "easterEgg.dialogLabel": "WeChat QR code",
    "easterEgg.closeLabel": "Close WeChat QR code",
    "easterEgg.qrAlt": "WeChat QR code for Dachuan Song",
    "nav.about": "About",
    "nav.skills": "Skills",
    "nav.papers": "Papers",
    "nav.cv": "CV",
    "nav.contact": "Contact",
    "hero.eyebrow": "State Space Models · Long-Context Memory · Efficient Inference",
    "hero.lead":
      "I build <strong>state-space language models for long-context memory and retrieval</strong>. My first-author <strong>NeurIPS 2026</strong> work makes one training run serve multiple inference budgets.",
    "hero.availability": "Seeking Summer 2027 research internships in the U.S.",
    "hero.linksLabel": "Profile links",
    "links.email": "Email",
    "links.emailCopyAria": "Copy email address",
    "links.emailCopied": "Copied",
    "links.emailCopyFailed": "Copy failed",
    "links.scholar": "Google Scholar",
    "profile.summaryLabel": "Profile summary",
    "profile.role": "Ph.D. Student",
    "profile.program": "Electrical & Computer Engineering",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "Research focus",
    "about.title": "State-space models.<br>Long-context memory.",
    "about.p1":
      "I am a Ph.D. student in Electrical and Computer Engineering at <a class=\"direction-link\" href=\"https://www.gmu.edu/\" target=\"_blank\" rel=\"noreferrer\">George Mason University</a>, advised by <a class=\"direction-link\" href=\"https://mason.gmu.edu/~xwang64/index.html\" target=\"_blank\" rel=\"noreferrer\">Prof. Xuan Wang</a>. I study how language models can <strong>retain and retrieve useful information over long sequences</strong> while keeping computation manageable.",
    "about.p2":
      "My current project, <strong>Sparse Delta Cache (SDC)</strong>, develops <strong>attention-free memory augmentation for state-space models</strong>. The goal is stronger memory retention and retrieval, with computation that grows linearly with sequence length.",
    "areas.kicker": "Research directions",
    "areas.agent.title": "Efficient Recurrent Inference",
    "areas.agent.body":
      "Connect model architecture to GPU execution through fused recurrent decoding. Measure latency, throughput, and memory use under matched benchmark conditions.",
    "areas.sequence.title": "Attention-Free Memory",
    "areas.sequence.body":
      "Study how state-space models can retain and retrieve information over long contexts without attention, with linear computational scaling as a design goal.",
    "areas.ssm.title": "Train-Once Model Compression",
    "areas.ssm.body":
      "Build compact, standalone models from one trained checkpoint. Spectral-channel structure makes different deployment capacities part of the training objective.",
    "skills.kicker": "Skills",
    "skills.title": "Methods & engineering",
    "skills.dl.title": "Model Training",
    "skills.dl.1": "Python, PyTorch & multi-GPU training",
    "skills.dl.2": "Foundation model adaptation",
    "skills.dl.3": "Optimization & controlled ablations",
    "skills.sequence.title": "Memory & Retrieval",
    "skills.sequence.1": "Long-context retention & recall",
    "skills.sequence.2": "Recurrent memory & state updates",
    "skills.sequence.3": "Memory and retrieval evaluation",
    "skills.ssm.title": "State-Space Models",
    "skills.ssm.1": "Spectral & selective SSMs",
    "skills.ssm.2": "Linear dynamical systems",
    "skills.ssm.3": "Attention-free & hybrid architectures",
    "skills.agent.title": "Efficient Inference",
    "skills.agent.1": "CUDA & fused recurrent decoding",
    "skills.agent.2": "Model compression & compact export",
    "skills.agent.3": "Latency, throughput & memory profiling",
    "publications.kicker": "Research & experience",
    "publications.title": "Papers & selected work",
    "publications.link.code": "Code",
    "publications.links.sketchops": "SketchOps paper links",
    "publications.links.es": "Elastic Spectral State Space Models links",
    "publications.links.essh": "Elastic Selective Spectral Hybrids paper links",
    "publications.links.fmri": "fMRI journal article links",
    "publications.links.bcb": "ACM BCB conference paper links",
    "publications.sketchops.type": "Preprint",
    "publications.sketchops.venue": "arXiv · 2026",
    "publications.sketchops.title": "Mergeable Model-Side Aggregation States for Long-Context Language Models",
    "publications.sketchops.summary":
      "<strong>Long-context aggregation in a fixed 2 KiB state.</strong> SketchOps augments a frozen language model with mergeable summaries of counts and set relations. On 3,969 aggregate-then-reason tasks with Gemma 4 (31B), it achieved <strong>99.2% accuracy</strong> without rereading the full history.",
    "publications.sketchops.keywords":
      "SketchOps · Mergeable memory · Long-context aggregation",
    "publications.es.type": "Conference Paper",
    "publications.es.venue": "First author · Accepted poster",
    "publications.es.badge": "<span class=\"neurips-year\">NeurIPS 2026</span><span class=\"neurips-track\">Main Track</span>",
    "publications.es.title": "Elastic Spectral State Space Models for Train-Once Budgeted Inference",
    "publications.es.summary":
      "<strong>Train once, export compact models for different compute budgets.</strong> ES-SSM combines ordered Hankel spectral channels with input-adaptive gates and budget dropout. Direct prefix truncation produces independently deployable models <strong>without budget-specific retraining</strong>.",
    "publications.es.keywords": "Spectral state-space models · Compact model export · Budgeted inference",
    "publications.es.imageAlt": "Figure 1 of ES-SSM: spectral channels and compact model export",
    "publications.essh.type": "Preprint",
    "publications.essh.venue": "arXiv · 2026",
    "publications.essh.title": "Elastic Selective Spectral Hybrids for Train-Once, Export-Many Budgeted Inference",
    "publications.essh.summary":
      "<strong>Selective spectral memory with fast recurrent decoding.</strong> ESSH pairs input-dependent decay and write/read gates with sliding-window attention, then exports several model sizes from one trained checkpoint. At 1.53B parameters, fused decoding reached <strong>1.37 ms/token</strong> on B300, <strong>2.14–2.80× faster</strong> than the tested, parameter-matched Mamba-2/Mamba-3 implementations (batch 1, 2K context).",
    "publications.essh.keywords": "Selective spectral recurrence · Compact language models · Fused decoding",
    "publications.essh.imageAlt": "Figure 1 of ESSH: selective spectral hybrid and elastic capacity axes",
    "publications.fmri.type": "Journal Article",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title":
      "Reconstructing brain causal dynamics for subject and task fingerprints using fMRI time-series data",
    "publications.fmri.summary":
      "<strong>Directed brain dynamics as signatures of subjects and tasks.</strong> Reconstructs fast and slow activity and directed interactions from fMRI, then uses these dynamic signatures for identification. A brain reachability map visualizes task-specific patterns across regions.",
    "publications.fmri.keywords": "Dynamic system identification · Temporal modeling · Brain reachability",
    "publications.bcb.type": "Conference Paper",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "Oral Presentation",
    "publications.bcb.title": "Causality-based Subject and Task Fingerprints using fMRI Time-series Data",
    "publications.bcb.summary":
      "<strong>Two-timescale dynamics for subject and task identification.</strong> A state-space model reconstructs directional interactions from fMRI time series. Modal features identify subjects, while a graph neural network classifies tasks.",
    "publications.bcb.keywords": "Two-timescale dynamics · State-space modeling · Graph learning",
    "publications.internship.type": "Internship",
    "publications.internship.venue": "Optosurgical · Summer 2026",
    "publications.internship.title": "Surgical Video Understanding and Efficient Depth Estimation",
    "publications.internship.role": "Machine Learning Engineer Intern",
    "publications.internship.summary":
      "<strong>Video understanding and model compression for surgical systems.</strong> Built models for surgical-phase and instrument-action recognition. Compressed and fine-tuned Depth Anything 3 to <strong>29% of its original model size</strong> while retaining near-baseline depth-estimation performance.",
    "publications.internship.keywords":
      "Computer vision · Surgical video understanding · Model compression · Depth estimation",
    "publications.internship.imageAlt":
      "Combined non-graphic surgical grasper and clip-applier illustration beside a masked small-model depth prediction",
    "education.kicker": "Education",
    "education.title": "Education & research service",
    "education.cv": "View CV (PDF)",
    "education.gmu.level": "Ph.D.",
    "education.gmu.school": "George Mason University",
    "education.gmu.program": "Electrical and Computer Engineering · Expected May 2028",
    "education.southampton.level": "M.Sc.",
    "education.southampton.school": "University of Southampton",
    "education.southampton.program": "Computer Science",
    "education.xju.level": "B.Eng.",
    "education.xju.school": "Xinjiang University",
    "education.xju.program": "Software Engineering",
    "awards.label": "Reviewer recognition",
    "awards.icml.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "awards.icml.body": "Recognized for review quality, based on Area Chair evaluations.",
    "awards.service": "Reviewer for NeurIPS 2026 and AAAI 2027.",
    "contact.kicker": "Contact",
    "contact.title": "Let’s connect on state-space models, long-context memory, and efficient inference.",
    "contact.email": "dsong25@gmu.edu",
  },
  zh: {
    "meta.title": "Dachuan Song | AI 研究与工程",
    "meta.description":
      "宋大川，乔治梅森大学博士研究生。以第一作者身份获 NeurIPS 2026 主会接收，研究状态空间模型、长上下文记忆与检索，以及高效推理。",
    "language.button": "EN",
    "language.aria": "Switch to English",
    "easterEgg.coinLabel": "隐藏联系彩蛋",
    "easterEgg.dialogLabel": "微信二维码",
    "easterEgg.closeLabel": "关闭微信二维码",
    "easterEgg.qrAlt": "Dachuan Song 的微信二维码",
    "nav.about": "关于",
    "nav.skills": "技能",
    "nav.papers": "论文",
    "nav.cv": "简历",
    "nav.contact": "联系",
    "hero.eyebrow": "状态空间模型 · 长上下文记忆 · 高效推理",
    "hero.lead":
      "我研究用于<strong>长上下文记忆与检索的状态空间语言模型</strong>。我的第一作者论文已被 <strong>NeurIPS 2026</strong> 主会接收，实现一次训练、多档推理预算下的模型部署。",
    "hero.availability": "正在寻找美国 2027 年暑期研究实习。",
    "hero.linksLabel": "个人链接",
    "links.email": "邮箱",
    "links.emailCopyAria": "复制邮箱地址",
    "links.emailCopied": "已复制",
    "links.emailCopyFailed": "复制失败",
    "links.scholar": "Google Scholar",
    "profile.summaryLabel": "个人简介",
    "profile.role": "博士研究生",
    "profile.program": "电子与计算机工程",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "研究主线",
    "about.title": "状态空间模型。<br>长上下文记忆。",
    "about.p1":
      "我是<a class=\"direction-link\" href=\"https://www.gmu.edu/\" target=\"_blank\" rel=\"noreferrer\">乔治梅森大学</a>电子与计算机工程博士研究生，导师为 <a class=\"direction-link\" href=\"https://mason.gmu.edu/~xwang64/index.html\" target=\"_blank\" rel=\"noreferrer\">Xuan Wang 教授</a>。我的研究关注语言模型如何在计算成本可控的条件下，<strong>保留并检索长序列中的有用信息</strong>。",
    "about.p2":
      "目前的项目 <strong>Sparse Delta Cache（SDC）</strong> 探索<strong>无需 Attention 的状态空间模型记忆增强</strong>，目标是在计算量随序列长度线性增长的条件下，提升记忆保持与检索能力。",
    "areas.kicker": "研究方向",
    "areas.agent.title": "高效递归推理",
    "areas.agent.body":
      "通过融合递归解码连接模型结构与 GPU 执行，在匹配的测试条件下评估延迟、吞吐量与内存开销。",
    "areas.sequence.title": "Attention-Free 记忆增强",
    "areas.sequence.body":
      "研究状态空间模型如何不依赖 Attention，保留并检索长上下文信息，并将计算量随序列长度线性增长作为设计目标。",
    "areas.ssm.title": "一次训练，多预算部署",
    "areas.ssm.body":
      "从一个训练好的检查点导出可独立部署的紧凑模型，通过谱通道结构，在训练时就优化不同部署容量。",
    "skills.kicker": "技能",
    "skills.title": "研究方法与工程能力",
    "skills.dl.title": "模型训练",
    "skills.dl.1": "Python、PyTorch 与多 GPU 训练",
    "skills.dl.2": "基础模型适配",
    "skills.dl.3": "优化与受控消融实验",
    "skills.sequence.title": "记忆与检索",
    "skills.sequence.1": "长上下文信息保持与召回",
    "skills.sequence.2": "递归记忆与状态更新",
    "skills.sequence.3": "记忆与检索能力评测",
    "skills.ssm.title": "状态空间模型",
    "skills.ssm.1": "谱 SSM 与选择性 SSM",
    "skills.ssm.2": "线性动力系统",
    "skills.ssm.3": "Attention-Free 与混合架构",
    "skills.agent.title": "高效推理",
    "skills.agent.1": "CUDA 与融合递归解码",
    "skills.agent.2": "模型压缩与紧凑导出",
    "skills.agent.3": "延迟、吞吐量与内存分析",
    "publications.kicker": "研究成果与实践",
    "publications.title": "论文与研究实践",
    "publications.link.code": "代码",
    "publications.links.sketchops": "SketchOps 论文相关链接",
    "publications.links.es": "弹性谱状态空间模型相关链接",
    "publications.links.essh": "弹性选择性谱混合模型论文链接",
    "publications.links.fmri": "fMRI 期刊论文相关链接",
    "publications.links.bcb": "ACM BCB 会议论文相关链接",
    "publications.sketchops.type": "预印本",
    "publications.sketchops.venue": "arXiv · 2026",
    "publications.sketchops.title": "面向长上下文语言模型的可合并模型侧聚合状态",
    "publications.sketchops.summary":
      "<strong>用固定 2 KiB 状态完成长上下文信息聚合。</strong>SketchOps 在冻结语言模型旁维护可跨片段合并的计数与集合关系摘要。在 Gemma 4（31B）的 3,969 道聚合后推理任务上，达到 <strong>99.2% 准确率</strong>，无需重读完整历史。",
    "publications.sketchops.keywords":
      "SketchOps · 可合并记忆 · 长上下文聚合",
    "publications.es.type": "会议论文",
    "publications.es.venue": "第一作者 · 已接收 · 海报展示",
    "publications.es.badge": "<span class=\"neurips-year\">NeurIPS 2026</span><span class=\"neurips-track\">Main Track</span>",
    "publications.es.title": "可一次训练并按预算导出的弹性谱状态空间模型",
    "publications.es.summary":
      "<strong>一次训练，导出适配不同计算预算的紧凑模型。</strong>ES-SSM 将有序 Hankel 谱通道与输入自适应门控、预算丢弃训练结合，通过直接截断谱通道前缀得到可独立部署的小模型，<strong>无需针对各档预算重新训练</strong>。",
    "publications.es.keywords": "谱状态空间模型 · 紧凑模型导出 · 预算约束推理",
    "publications.es.imageAlt": "ES-SSM 图 1：谱通道与紧凑模型导出",
    "publications.essh.type": "预印本",
    "publications.essh.venue": "arXiv · 2026",
    "publications.essh.title": "用于一次训练、多预算导出的弹性选择性谱混合模型",
    "publications.essh.summary":
      "<strong>让谱记忆具备输入选择性，并实现高效递归解码。</strong>ESSH 将输入依赖的衰减与读写门控、滑窗注意力结合，从一个训练好的检查点导出多档模型。1.53B 参数配置在 B300 上的融合解码为 <strong>1.37 ms/token</strong>，比测试中参数匹配的 Mamba-2/Mamba-3 实现<strong>快 2.14–2.80 倍</strong>（batch 1，2K 上下文）。",
    "publications.essh.keywords": "选择性谱递归 · 紧凑语言模型 · 融合解码",
    "publications.essh.imageAlt": "ESSH 图 1：选择性谱混合架构与弹性容量维度",
    "publications.fmri.type": "期刊论文",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title": "使用 fMRI 时间序列数据重建用于主体和任务指纹识别的大脑因果动态",
    "publications.fmri.summary":
      "<strong>从有向脑动态中提取受试者与任务指纹。</strong>重建 fMRI 中的快慢活动与脑区间有向作用，并以这些动态特征进行识别；脑区可达性图进一步展示不同任务对应的区域活动模式。",
    "publications.fmri.keywords": "动态系统辨识 · 时序建模 · 脑区可达性",
    "publications.bcb.type": "会议论文",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "口头报告",
    "publications.bcb.title": "基于因果性的 fMRI 时间序列主体与任务指纹识别",
    "publications.bcb.summary":
      "<strong>用双时间尺度动态特征识别受试者与任务。</strong>状态空间模型从 fMRI 时间序列中重建脑区间的有向作用，再以模态特征识别受试者，以图神经网络完成任务分类。",
    "publications.bcb.keywords": "双时间尺度动态 · 状态空间建模 · 图学习",
    "publications.internship.type": "实习",
    "publications.internship.venue": "Optosurgical · 2026 夏季",
    "publications.internship.title": "手术视频理解与高效深度估计",
    "publications.internship.role": "机器学习工程师实习生",
    "publications.internship.summary":
      "<strong>面向手术系统的视频理解与模型压缩。</strong>开发手术阶段和器械动作识别模型，并将 Depth Anything 3 压缩、微调至<strong>原模型大小的 29%</strong>，深度估计性能接近完整模型。",
    "publications.internship.keywords":
      "计算机视觉 · 手术视频理解 · 模型压缩 · 深度估计",
    "publications.internship.imageAlt":
      "合成的非血腥手术夹持与施夹器械示意，以及视野外区域为黑色的小模型深度预测图",
    "education.kicker": "教育",
    "education.title": "教育经历与学术服务",
    "education.cv": "查看简历（PDF）",
    "education.gmu.level": "博士",
    "education.gmu.school": "乔治梅森大学",
    "education.gmu.program": "电子与计算机工程 · 预计 2028 年 5 月毕业",
    "education.southampton.level": "硕士",
    "education.southampton.school": "南安普顿大学",
    "education.southampton.program": "计算机科学",
    "education.xju.level": "本科",
    "education.xju.school": "新疆大学",
    "education.xju.program": "软件工程",
    "awards.label": "审稿荣誉",
    "awards.icml.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "awards.icml.body": "审稿质量获得领域主席（Area Chairs）认可。",
    "awards.service": "担任 NeurIPS 2026 与 AAAI 2027 审稿人。",
    "contact.kicker": "联系",
    "contact.title": "欢迎交流状态空间模型、长上下文记忆与高效推理。",
    "contact.email": "dsong25@gmu.edu",
  },
};

const languageStorageKey = "dachuan-site-language";
const languageToggle = document.querySelector("[data-lang-toggle]");
const descriptionMeta = document.querySelector('meta[name="description"]');
const coinEasterEgg = document.querySelector("[data-coin-easter-egg]");
const wechatDialog = document.querySelector("[data-wechat-dialog]");
const wechatDialogClose = document.querySelector("[data-wechat-dialog-close]");
const emailCopyButtons = document.querySelectorAll("[data-copy-email]");
const portraitRing = document.querySelector(".portrait-ring");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let currentLanguage = "en";
let coinClickCount = 0;
const emailFeedbackTimers = new WeakMap();
let emailPopover;
let emailPopoverTimer;
let emailPopoverButton;

const getTranslation = (language, key) => translations[language]?.[key] ?? translations.en[key] ?? "";

function setLanguage(language) {
  currentLanguage = translations[language] ? language : "en";
  document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
  document.title = getTranslation(currentLanguage, "meta.title");

  if (descriptionMeta) {
    descriptionMeta.setAttribute("content", getTranslation(currentLanguage, "meta.description"));
  }

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = getTranslation(currentLanguage, element.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = getTranslation(currentLanguage, element.dataset.i18nHtml);
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", getTranslation(currentLanguage, element.dataset.i18nAria));
  });

  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    element.setAttribute("alt", getTranslation(currentLanguage, element.dataset.i18nAlt));
  });

  if (languageToggle) {
    languageToggle.textContent = getTranslation(currentLanguage, "language.button");
    languageToggle.setAttribute("aria-label", getTranslation(currentLanguage, "language.aria"));
  }

  localStorage.setItem(languageStorageKey, currentLanguage);
}

function getInitialLanguage() {
  const urlLanguage = new URLSearchParams(window.location.search).get("lang");
  const savedLanguage = localStorage.getItem(languageStorageKey);

  if (translations[urlLanguage]) return urlLanguage;
  if (translations[savedLanguage]) return savedLanguage;
  return "en";
}

document.getElementById("year").textContent = new Date().getFullYear();

if (languageToggle) {
  languageToggle.addEventListener("click", () => {
    setLanguage(currentLanguage === "en" ? "zh" : "en");
  });
}

function copyWithFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("Clipboard copy failed");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      copyWithFallback(text);
      return;
    }
  }

  copyWithFallback(text);
}

function hideEmailPopover() {
  if (emailPopover) emailPopover.hidden = true;
  if (emailPopoverTimer) window.clearTimeout(emailPopoverTimer);
  emailPopoverButton?.closest(".footer-links")?.classList.remove("email-popover-open");
  emailPopoverButton = null;
  emailPopoverTimer = null;
}

function positionEmailPopover() {
  if (!emailPopover || emailPopover.hidden || !emailPopoverButton) return;

  const buttonRect = emailPopoverButton.getBoundingClientRect();
  const popoverRect = emailPopover.getBoundingClientRect();
  const left = Math.max(
    12,
    Math.min(
      buttonRect.left + (buttonRect.width - popoverRect.width) / 2,
      window.innerWidth - popoverRect.width - 12
    )
  );
  const below = buttonRect.bottom + 9;
  const top = below + popoverRect.height <= window.innerHeight - 8
    ? below
    : Math.max(8, buttonRect.top - popoverRect.height - 9);

  emailPopover.style.left = `${left}px`;
  emailPopover.style.top = `${top}px`;
}

function showEmailPopover(button) {
  if (!emailPopover) {
    emailPopover = document.createElement("div");
    emailPopover.className = "email-copy-popover";
    emailPopover.setAttribute("role", "status");
    emailPopover.setAttribute("aria-live", "polite");
    emailPopover.hidden = true;
    document.body.append(emailPopover);
  }

  hideEmailPopover();
  emailPopoverButton = button;
  button.closest(".footer-links")?.classList.add("email-popover-open");
  emailPopover.textContent = button.dataset.copyEmail;
  emailPopover.hidden = false;
  positionEmailPopover();
  emailPopoverTimer = window.setTimeout(hideEmailPopover, 2800);
}

emailCopyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const defaultKey = button.dataset.i18n;
    const existingTimer = emailFeedbackTimers.get(button);
    if (existingTimer) window.clearTimeout(existingTimer);
    showEmailPopover(button);

    try {
      await copyText(button.dataset.copyEmail);
      button.textContent = getTranslation(currentLanguage, "links.emailCopied");
      button.dataset.copyState = "success";
    } catch {
      button.textContent = getTranslation(currentLanguage, "links.emailCopyFailed");
      button.dataset.copyState = "error";
    }

    const timer = window.setTimeout(() => {
      button.textContent = getTranslation(currentLanguage, defaultKey);
      button.removeAttribute("data-copy-state");
      emailFeedbackTimers.delete(button);
    }, 1600);
    emailFeedbackTimers.set(button, timer);
  });
});

window.addEventListener("scroll", positionEmailPopover, { passive: true });
window.addEventListener("resize", positionEmailPopover);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideEmailPopover();
});

function resetPortraitInteraction() {
  if (!portraitRing) return;

  portraitRing.style.setProperty("--portrait-shadow-x", "0px");
  portraitRing.style.setProperty("--portrait-shadow-y", "7px");
  portraitRing.style.setProperty("--portrait-tilt-x", "0deg");
  portraitRing.style.setProperty("--portrait-tilt-y", "0deg");
  portraitRing.classList.remove("is-pressed");
}

if (portraitRing) {
  portraitRing.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || prefersReducedMotion.matches) return;

    const bounds = portraitRing.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    const normalizedX = x * 2 - 1;
    const normalizedY = y * 2 - 1;

    portraitRing.style.setProperty("--portrait-shadow-x", `${(-normalizedX * 4).toFixed(2)}px`);
    portraitRing.style.setProperty("--portrait-shadow-y", `${(7 - normalizedY * 2).toFixed(2)}px`);
    portraitRing.style.setProperty("--portrait-tilt-x", `${(-normalizedY * 5.5).toFixed(2)}deg`);
    portraitRing.style.setProperty("--portrait-tilt-y", `${(normalizedX * 5.5).toFixed(2)}deg`);
  });

  portraitRing.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || prefersReducedMotion.matches) return;
    portraitRing.classList.add("is-pressed");
  });

  portraitRing.addEventListener("pointerup", () => {
    portraitRing.classList.remove("is-pressed");
  });
  portraitRing.addEventListener("pointercancel", resetPortraitInteraction);
  portraitRing.addEventListener("pointerleave", resetPortraitInteraction);
}

function closeWechatDialog() {
  if (!wechatDialog) return;

  if (typeof wechatDialog.close === "function") {
    wechatDialog.close();
  } else {
    wechatDialog.removeAttribute("open");
  }

  coinEasterEgg?.setAttribute("aria-expanded", "false");
}

if (coinEasterEgg && wechatDialog) {
  coinEasterEgg.addEventListener("click", () => {
    if (wechatDialog.open) {
      closeWechatDialog();
      return;
    }

    coinClickCount += 1;

    if (coinClickCount < 5) return;

    coinClickCount = 0;
    if (typeof wechatDialog.show === "function") {
      wechatDialog.show();
    } else {
      wechatDialog.setAttribute("open", "");
    }

    coinEasterEgg.setAttribute("aria-expanded", "true");
    wechatDialogClose?.focus({ preventScroll: true });
  });

  wechatDialogClose?.addEventListener("click", closeWechatDialog);

  document.addEventListener("pointerdown", (event) => {
    if (!wechatDialog.open) return;
    if (wechatDialog.contains(event.target) || coinEasterEgg.contains(event.target)) return;
    closeWechatDialog();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !wechatDialog.open) return;
    event.preventDefault();
    closeWechatDialog();
  });

  wechatDialog.addEventListener("close", () => {
    coinClickCount = 0;
  });
}

setLanguage(getInitialLanguage());
