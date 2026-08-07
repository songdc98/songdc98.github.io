const translations = {
  en: {
    "meta.title": "Dachuan Song | AI Research & Engineering",
    "meta.description":
      "Dachuan Song is a Ph.D. student at George Mason University researching deep learning, state space models, long-sequence modeling, and LLM-based systems.",
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
    "hero.eyebrow": "Deep Learning · State Space Models · Long Contexts · LLM Agents",
    "hero.lead":
      "I study how learning systems can process long sequences efficiently and use accumulated information reliably in complex tasks.",
    "hero.linksLabel": "Profile links",
    "links.email": "Email",
    "links.emailCopyAria": "Copy email address",
    "links.emailCopied": "Copied",
    "links.emailCopyFailed": "Copy failed",
    "links.scholar": "Scholar",
    "profile.summaryLabel": "Profile summary",
    "profile.role": "Ph.D. Student",
    "profile.program": "Electrical & Computer Engineering",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "Direction",
    "about.title": "Deep Learning, Sequence Modeling, and LLM-Based Systems.",
    "about.p1":
      "I am a Ph.D. student at <strong>George Mason University</strong>, advised by <strong>Prof. Xuan Wang</strong>. I study learning systems that must process long and evolving information under practical constraints on computation, memory, and latency.",
    "about.p2":
      "My research focuses on state space models, long-sequence modeling, and LLM-based agents, with an emphasis on efficient and reliable learning systems.",
    "areas.kicker": "Research Areas",
    "areas.agent.title": "Reliable LLM Agents",
    "areas.agent.body":
      "Agent memory, provenance tracking, and tool-use mechanisms designed to reduce stale information use and improve workflow reliability.",
    "areas.sequence.title": "Long-Context Aggregation",
    "areas.sequence.body":
      "Model-side mechanisms that preserve, compress, and merge information from long inputs under fixed memory and inference budgets.",
    "areas.ssm.title": "Spectral State Space Models",
    "areas.ssm.body":
      "State-space sequence models with spectral structure and elastic capacity for efficient, budget-aware inference.",
    "skills.kicker": "Skills",
    "skills.title": "Core technical areas.",
    "skills.dl.title": "Deep Learning",
    "skills.dl.1": "Transformers and attention",
    "skills.dl.2": "Foundation model adaptation",
    "skills.dl.3": "Optimization and representation learning",
    "skills.sequence.title": "Long-Sequence Modeling",
    "skills.sequence.1": "Long-context aggregation",
    "skills.sequence.2": "Length generalization",
    "skills.sequence.3": "Budget-aware inference",
    "skills.ssm.title": "State Space Models",
    "skills.ssm.1": "Spectral state-space models",
    "skills.ssm.2": "Linear dynamical systems",
    "skills.ssm.3": "Efficient sequence operators",
    "skills.agent.title": "LLM Agents",
    "skills.agent.1": "Tool-using agents",
    "skills.agent.2": "Agent memory",
    "skills.agent.3": "Workflow reliability",
    "publications.kicker": "Publications",
    "publications.title": "Published papers",
    "publications.link.code": "Code",
    "publications.links.sketchops": "SketchOps paper links",
    "publications.links.es": "Elastic Spectral State Space Models links",
    "publications.links.fmri": "fMRI journal article links",
    "publications.links.bcb": "ACM BCB conference paper links",
    "publications.sketchops.type": "Preprint",
    "publications.sketchops.venue": "arXiv · 2026",
    "publications.sketchops.title": "Mergeable Model-Side Aggregation States for Long-Context Language Models",
    "publications.sketchops.summary":
      "Introduced SketchOps, a model-side aggregation interface that keeps compact, mergeable sketch states alongside frozen language models for fixed-budget long-context aggregation.",
    "publications.sketchops.keywords":
      "SketchOps · HyperLogLog · Long-context reasoning · Fixed-budget aggregation",
    "publications.es.type": "Preprint",
    "publications.es.venue": "arXiv · 2026",
    "publications.es.title": "Elastic Spectral State Space Models for Budgeted Inference",
    "publications.es.summary":
      "Developed ES-SSM to train once at full spectral capacity and deploy elastically through masked normalization and input-adaptive spectral gating.",
    "publications.es.keywords": "PyTorch · CUDA · FFT convolution · Long-context benchmarks",
    "publications.fmri.type": "Journal Article",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title":
      "Reconstructing brain causal dynamics for subject and task fingerprints using fMRI time-series data",
    "publications.fmri.summary":
      "Reconstructed brain causal dynamics for subject and task fingerprints, connecting causal time-series modeling with interpretable neural signatures.",
    "publications.fmri.keywords": "fMRI · Causal dynamics · Time-series modeling · Health AI",
    "publications.bcb.type": "Conference Paper",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "Oral Presentation",
    "publications.bcb.title": "Causality-based Subject and Task Fingerprints using fMRI Time-series Data",
    "publications.bcb.summary":
      "Studied subject and task fingerprints from fMRI time-series data through causal modeling, with an oral presentation at ACM BCB 2024.",
    "publications.bcb.keywords": "ACM BCB · Causal modeling · fMRI · Health AI",
    "publications.internship.type": "Internship",
    "publications.internship.venue": "Optosurgical · Summer 2026",
    "publications.internship.title": "Surgical Video Understanding and Efficient Depth Estimation",
    "publications.internship.role": "Machine Learning Engineer Intern",
    "publications.internship.summary":
      "Designed video models to recognize surgical phases and instrument actions from endoscopic footage, helping downstream robotic systems track procedure state. Separately compressed Depth Anything 3 into a smaller depth model and used teacher-guided fine-tuning to recover surgical-scene depth estimation quality under a much lower parameter budget.",
    "publications.internship.keywords":
      "Surgical phase recognition · Robot-assisted surgery · Model compression · Monocular depth estimation",
    "publications.internship.imageAlt":
      "Non-graphic surgical instrument-action illustrations followed by a cropped endoscopic frame and its predicted depth map",
    "education.kicker": "Education",
    "education.title": "Academic Background.",
    "education.gmu.level": "Ph.D.",
    "education.gmu.school": "George Mason University",
    "education.gmu.program": "Electrical and Computer Engineering",
    "education.southampton.level": "M.Sc.",
    "education.southampton.school": "University of Southampton",
    "education.southampton.program": "Computer Science",
    "education.xju.level": "B.Eng.",
    "education.xju.school": "Xinjiang University",
    "education.xju.program": "Software Engineering",
    "awards.label": "Reviewer recognition",
    "awards.icml.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "awards.icml.body": "Recognized for review quality evaluated by Area Chairs.",
    "contact.kicker": "Contact",
    "contact.title": "Open to collaborations across deep learning, sequence modeling, and large language model research.",
    "contact.email": "dsong25@gmu.edu",
  },
  zh: {
    "meta.title": "Dachuan Song | AI 研究与工程",
    "meta.description":
      "Dachuan Song 是乔治梅森大学电子与计算机工程博士研究生，研究深度学习、状态空间模型、长序列建模与大语言模型系统。",
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
    "hero.eyebrow": "深度学习 · 状态空间模型 · 长上下文 · 大语言模型智能体",
    "hero.lead":
      "我研究学习系统如何高效处理长序列，并在复杂任务中可靠地使用累积信息。",
    "hero.linksLabel": "个人链接",
    "links.email": "邮箱",
    "links.emailCopyAria": "复制邮箱地址",
    "links.emailCopied": "已复制",
    "links.emailCopyFailed": "复制失败",
    "links.scholar": "学术主页",
    "profile.summaryLabel": "个人简介",
    "profile.role": "博士研究生",
    "profile.program": "电子与计算机工程",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "方向",
    "about.title": "深度学习、序列建模与大语言模型系统。",
    "about.p1":
      "我是 <strong>乔治梅森大学</strong> 电子与计算机工程博士研究生，导师为 <strong>Xuan Wang 教授</strong>。我研究学习系统如何在计算、内存和延迟等实际约束下处理长序列与持续变化的信息。",
    "about.p2":
      "我的研究方向包括状态空间模型、长序列建模与基于大语言模型的智能体，重点关注学习系统的效率与可靠性。",
    "areas.kicker": "研究方向",
    "areas.agent.title": "可靠的大语言模型智能体",
    "areas.agent.body":
      "研究智能体记忆、来源追踪与工具调用机制，减少过期信息使用并提升工作流可靠性。",
    "areas.sequence.title": "长上下文聚合",
    "areas.sequence.body":
      "研究在固定记忆与推理预算下，对长输入信息进行保留、压缩与合并的模型侧机制。",
    "areas.ssm.title": "谱状态空间模型",
    "areas.ssm.body":
      "研究具有谱结构与弹性容量的状态空间序列模型，实现高效、预算感知的推理。",
    "skills.kicker": "技能",
    "skills.title": "核心技术方向。",
    "skills.dl.title": "深度学习",
    "skills.dl.1": "Transformer 与注意力",
    "skills.dl.2": "基础模型适配",
    "skills.dl.3": "优化与表征学习",
    "skills.sequence.title": "长序列建模",
    "skills.sequence.1": "长上下文聚合",
    "skills.sequence.2": "长度泛化",
    "skills.sequence.3": "预算约束推理",
    "skills.ssm.title": "状态空间模型",
    "skills.ssm.1": "谱状态空间模型",
    "skills.ssm.2": "线性动力系统",
    "skills.ssm.3": "高效序列算子",
    "skills.agent.title": "大语言模型智能体",
    "skills.agent.1": "工具调用智能体",
    "skills.agent.2": "智能体记忆",
    "skills.agent.3": "工作流可靠性",
    "publications.kicker": "论文",
    "publications.title": "发表文章",
    "publications.link.code": "代码",
    "publications.links.sketchops": "SketchOps 论文相关链接",
    "publications.links.es": "弹性谱状态空间模型相关链接",
    "publications.links.fmri": "fMRI 期刊论文相关链接",
    "publications.links.bcb": "ACM BCB 会议论文相关链接",
    "publications.sketchops.type": "预印本",
    "publications.sketchops.venue": "arXiv · 2026",
    "publications.sketchops.title": "面向长上下文语言模型的可合并模型侧聚合状态",
    "publications.sketchops.summary":
      "提出 SketchOps：一种模型侧聚合接口，在冻结语言模型旁维护紧凑、可合并的草图状态，用于固定预算的长上下文聚合。",
    "publications.sketchops.keywords":
      "SketchOps · HyperLogLog · 长上下文推理 · 固定预算聚合",
    "publications.es.type": "预印本",
    "publications.es.venue": "arXiv · 2026",
    "publications.es.title": "用于预算推理的弹性谱状态空间模型",
    "publications.es.summary":
      "提出 ES-SSM，在完整谱容量下训练一次，并通过掩码归一化和输入自适应谱门控进行弹性部署。",
    "publications.es.keywords": "PyTorch · CUDA · FFT 卷积 · 长上下文基准",
    "publications.fmri.type": "期刊论文",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title": "使用 fMRI 时间序列数据重建用于主体和任务指纹识别的大脑因果动态",
    "publications.fmri.summary":
      "重建用于主体和任务指纹识别的大脑因果动态，将因果时序建模与可解释神经信号连接起来。",
    "publications.fmri.keywords": "fMRI · 因果动态 · 时序建模 · 健康 AI",
    "publications.bcb.type": "会议论文",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "口头报告",
    "publications.bcb.title": "基于因果性的 fMRI 时间序列主体与任务指纹识别",
    "publications.bcb.summary":
      "通过因果建模研究 fMRI 时间序列中的主体与任务指纹识别，并在 ACM BCB 2024 作口头报告。",
    "publications.bcb.keywords": "ACM BCB · 因果建模 · fMRI · 健康 AI",
    "publications.internship.type": "实习",
    "publications.internship.venue": "Optosurgical · 2026 夏季",
    "publications.internship.title": "手术视频理解与高效深度估计",
    "publications.internship.role": "机器学习工程师实习生",
    "publications.internship.summary":
      "设计视频模型，从内窥镜画面识别手术阶段以及抓取、切割等器械动作，帮助下游手术机器人系统判断当前流程状态。另一项工作将 Depth Anything 3 压缩为小型深度模型，并通过教师模型指导的微调，在更低参数量下恢复其手术场景深度估计效果。",
    "publications.internship.keywords":
      "手术阶段识别 · 机器人辅助手术 · 模型压缩 · 单目深度估计",
    "publications.internship.imageAlt":
      "非血腥的手术器械动作示意，以及裁切后的内窥镜画面与对应深度预测图",
    "education.kicker": "教育",
    "education.title": "教育背景。",
    "education.gmu.level": "博士",
    "education.gmu.school": "乔治梅森大学",
    "education.gmu.program": "电子与计算机工程",
    "education.southampton.level": "硕士",
    "education.southampton.school": "南安普顿大学",
    "education.southampton.program": "计算机科学",
    "education.xju.level": "本科",
    "education.xju.school": "新疆大学",
    "education.xju.program": "软件工程",
    "awards.label": "审稿荣誉",
    "awards.icml.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "awards.icml.body": "评审质量获得 Area Chairs 认可。",
    "contact.kicker": "联系",
    "contact.title": "欢迎围绕深度学习、序列建模与大语言模型研究开展合作。",
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
let currentLanguage = "en";
let coinClickCount = 0;
const emailFeedbackTimers = new WeakMap();

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

emailCopyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const defaultKey = button.dataset.i18n;
    const existingTimer = emailFeedbackTimers.get(button);
    if (existingTimer) window.clearTimeout(existingTimer);

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
