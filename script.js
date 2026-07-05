const translations = {
  en: {
    "meta.title": "Dachuan Song | AI Research & Engineering",
    "meta.description":
      "Dachuan Song is a Ph.D. student in Electrical and Computer Engineering at George Mason University working on deep learning, long-context and sequence modeling, LLM-based agents, and model evaluation.",
    "language.button": "中文",
    "language.aria": "Switch to Chinese",
    "cat.label": "Interactive black cat companion",
    "nav.about": "About",
    "nav.work": "Work",
    "nav.skills": "Skills",
    "nav.papers": "Papers",
    "nav.code": "Code",
    "nav.cv": "CV",
    "nav.contact": "Contact",
    "hero.eyebrow": "Deep Learning · Long-Context Modeling · LLM-Based Agents · Model Evaluation",
    "hero.lead":
      "I work across deep learning, long-context and sequence modeling, model evaluation, and LLM-based agents. My research emphasizes mechanism-level questions, controlled experiments, and reproducible empirical evidence.",
    "hero.linksLabel": "Profile links",
    "links.email": "Email",
    "links.scholar": "Scholar",
    "profile.summaryLabel": "Profile summary",
    "profile.role": "Ph.D. Student",
    "profile.program": "Electrical & Computer Engineering",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "Direction",
    "about.title": "Deep Learning, Long Contexts, and LLM-Based Agents.",
    "about.p1":
      "I am a Ph.D. student at <strong>George Mason University</strong>, advised by <strong>Prof. Xuan Wang</strong>. My current interests include deep learning, long-context and sequence modeling, LLM-based agents, agent memory and reliability, and evaluation methods that separate real capability from measurement artifacts.",
    "about.p2":
      "I focus on problems that connect model mechanisms, implementation details, and empirical evaluation: how models generalize to longer inputs, aggregate information, reveal benchmark artifacts, and use memory safely in agent workflows.",
    "areas.kicker": "Research Areas",
    "areas.agent.title": "LLM-Based Agents",
    "areas.agent.body":
      "Research on large-language-model-based agents, including memory use, tool-use reliability, provenance, and current-use validity in agent workflows.",
    "areas.sequence.title": "Long-Context & Sequence Modeling",
    "areas.sequence.body":
      "Mechanisms for preserving, aggregating, and using information over long inputs, including sequence operators, state-space ideas, and length generalization.",
    "areas.health.title": "Evaluation & Diagnostics",
    "areas.health.body":
      "Controlled ablations, benchmark audits, multi-seed analysis, and null-calibrated tests for distinguishing real model behavior from artifacts.",
    "skills.kicker": "Skills",
    "skills.title": "Technical toolkit.",
    "skills.ml.title": "ML Foundations",
    "skills.ml.1": "Regression and classification",
    "skills.ml.2": "SVM, trees, and ensembles",
    "skills.ml.3": "PCA, clustering, and factor analysis",
    "skills.ml.4": "Cross-validation and regularization",
    "skills.dl.title": "Deep Learning",
    "skills.dl.1": "Transformers and attention",
    "skills.dl.2": "CNN, RNN, and LSTM models",
    "skills.dl.3": "GNN and temporal modeling",
    "skills.dl.4": "Optimization and loss design",
    "skills.sequence.title": "Long-Context Modeling",
    "skills.sequence.1": "Sequence operators and SSMs",
    "skills.sequence.2": "Long-context aggregation",
    "skills.sequence.3": "Length generalization",
    "skills.sequence.4": "Budget-aware inference",
    "skills.agent.title": "LLM-Based Agents",
    "skills.agent.1": "Agent memory and provenance",
    "skills.agent.2": "Long-context agent workflows",
    "skills.agent.3": "Tool-use reliability",
    "skills.agent.4": "Failure and stale-use analysis",
    "skills.eval.title": "Evaluation & Diagnostics",
    "skills.eval.1": "Controlled ablations",
    "skills.eval.2": "Benchmark artifact audits",
    "skills.eval.3": "Multi-seed experiment design",
    "skills.eval.4": "Claim-evidence checks",
    "skills.engineering.title": "Research Engineering",
    "skills.engineering.1": "PyTorch experiments",
    "skills.engineering.2": "CUDA-aware workflows",
    "skills.engineering.3": "Reproducible ablations",
    "skills.engineering.4": "Remote GPU execution",
    "skills.software.title": "Programming & Tools",
    "skills.software.1": "Python",
    "skills.software.2": "JavaScript and TypeScript",
    "skills.software.3": "Swift and iOS prototypes",
    "skills.software.4": "Git, Linux, and data pipelines",
    "work.kicker": "Selected Work",
    "work.title": "Research projects grounded in mechanisms and evaluation.",
    "work.es.time": "2026 · Preprint",
    "work.es.title": "Elastic Spectral State Space Models for Budgeted Inference",
    "work.es.body":
      "Developed ES-SSM to train once at full spectral capacity and deploy elastically by activating ordered spectral channels through masked normalization and input-adaptive spectral gating.",
    "work.es.stack": "PyTorch · CUDA · FFT convolution · Long-context benchmarks",
    "work.fmri.time": "2024–2025 · Publication line",
    "work.fmri.title": "Causal Fingerprinting from fMRI Time-Series Data",
    "work.fmri.body":
      "Reconstructed brain causal dynamics for subject and task fingerprints, connecting causal time-series modeling with interpretable neural signatures.",
    "work.fmri.stack": "fMRI · Causal dynamics · Time-series modeling · Health AI",
    "work.eeg.time": "2023 · Master project",
    "work.eeg.title": "Machine Learning for EEG Brain Activity Patterns",
    "work.eeg.body":
      "Built a deep learning pipeline combining CNN spatial extraction, LSTM temporal modeling, attention, autoencoder pretraining, and transfer learning.",
    "work.eeg.stack": "CNN · LSTM · Attention · Autoencoder · ResNet50",
    "publications.kicker": "Publications",
    "publications.title": "Published papers",
    "publications.es.type": "Preprint",
    "publications.es.venue": "arXiv · 2026",
    "publications.es.title": "Elastic Spectral State Space Models for Budgeted Inference",
    "publications.fmri.type": "Journal Article",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title":
      "Reconstructing brain causal dynamics for subject and task fingerprints using fMRI time-series data",
    "publications.bcb.type": "Conference Paper",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "Oral Presentation",
    "publications.bcb.title": "Causality-based Subject and Task Fingerprints using fMRI Time-series Data",
    "projects.kicker": "Open Code",
    "projects.title": "Open research code.",
    "projects.es.body": "Budget-aware state-space modeling with elastic spectral capacity for efficient inference.",
    "projects.health.body":
      "Local-only iOS health and training planner using personal baselines, recovery state, and workout history.",
    "projects.story.body": "English learning product concept that turns vocabulary into story-based daily practice.",
    "projects.researchCode": "Research code",
    "projects.projectPage": "Project page",
    "education.kicker": "Education & Service",
    "education.title": "Academic Background.",
    "education.gmu.degree": "Ph.D. in Electrical and Computer Engineering · 2024–Present",
    "education.gmu.body":
      "Linear systems, random processes, Kalman filtering, distributed control and optimization, system identification.",
    "education.southampton.degree": "Master of Science (MSc)",
    "education.southampton.body":
      "Advanced machine learning, deep learning, computer vision, Bayesian learning, active and reinforcement learning.",
    "education.service.title": "Academic Service",
    "education.service.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "education.service.body": "Recognized for review quality evaluated by Area Chairs.",
    "contact.kicker": "Contact",
    "contact.title": "Open to collaborations on deep learning, long-context modeling, LLM-based agents, and model evaluation.",
  },
  zh: {
    "meta.title": "Dachuan Song | AI 研究与工程",
    "meta.description":
      "Dachuan Song 是 George Mason University 电子与计算机工程博士研究生，研究方向包括深度学习、长上下文与序列建模、基于大语言模型的智能体和模型评估。",
    "language.button": "EN",
    "language.aria": "Switch to English",
    "cat.label": "互动黑猫",
    "nav.about": "关于",
    "nav.work": "研究",
    "nav.skills": "技能",
    "nav.papers": "论文",
    "nav.code": "代码",
    "nav.cv": "简历",
    "nav.contact": "联系",
    "hero.eyebrow": "深度学习 · 长上下文建模 · 基于大语言模型的智能体 · 模型评估",
    "hero.lead":
      "我的研究覆盖深度学习、长上下文与序列建模、模型评估，以及基于大语言模型的智能体。我关注机制层面的研究问题、受控实验和可复现的实证证据。",
    "hero.linksLabel": "个人链接",
    "links.email": "邮箱",
    "links.scholar": "学术主页",
    "profile.summaryLabel": "个人简介",
    "profile.role": "博士研究生",
    "profile.program": "电子与计算机工程",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "方向",
    "about.title": "深度学习、长上下文与基于大语言模型的智能体。",
    "about.p1":
      "我是 <strong>George Mason University</strong> 电子与计算机工程博士研究生，导师是 <strong>Prof. Xuan Wang</strong>。我目前关注深度学习、长上下文与序列建模、基于大语言模型的智能体、智能体记忆与可靠性，以及区分真实能力和测量伪影的评估方法。",
    "about.p2":
      "我关注能把模型机制、实现细节和实证评估连接起来的问题：模型如何泛化到更长输入、如何聚合信息、如何暴露基准伪影，以及智能体如何安全地使用记忆。",
    "areas.kicker": "研究方向",
    "areas.agent.title": "基于大语言模型的智能体",
    "areas.agent.body":
      "研究基于大语言模型的智能体，包括记忆使用、工具使用可靠性、来源追踪，以及智能体流程中的当前使用有效性。",
    "areas.sequence.title": "长上下文与序列建模",
    "areas.sequence.body":
      "研究模型如何在长输入中保留、聚合和使用信息，包括序列算子、状态空间思想和长度泛化问题。",
    "areas.health.title": "评估与诊断",
    "areas.health.body":
      "通过受控消融、基准审计、多随机种子分析和零假设校准测试，区分真实模型行为和实验伪影。",
    "skills.kicker": "技能",
    "skills.title": "技术能力。",
    "skills.ml.title": "机器学习基础",
    "skills.ml.1": "回归与分类",
    "skills.ml.2": "SVM、树模型与集成方法",
    "skills.ml.3": "PCA、聚类与因子分析",
    "skills.ml.4": "交叉验证与正则化",
    "skills.dl.title": "深度学习",
    "skills.dl.1": "Transformer 与注意力",
    "skills.dl.2": "CNN、RNN 与 LSTM 模型",
    "skills.dl.3": "GNN 与时序建模",
    "skills.dl.4": "优化与损失设计",
    "skills.sequence.title": "长上下文建模",
    "skills.sequence.1": "序列算子与状态空间模型",
    "skills.sequence.2": "长上下文聚合",
    "skills.sequence.3": "长度泛化",
    "skills.sequence.4": "预算感知推理",
    "skills.agent.title": "基于大语言模型的智能体",
    "skills.agent.1": "智能体记忆与来源追踪",
    "skills.agent.2": "长上下文智能体流程",
    "skills.agent.3": "工具使用可靠性",
    "skills.agent.4": "失败与过期使用分析",
    "skills.eval.title": "评估与诊断",
    "skills.eval.1": "受控消融",
    "skills.eval.2": "基准伪影审计",
    "skills.eval.3": "多随机种子实验设计",
    "skills.eval.4": "主张-证据检查",
    "skills.engineering.title": "研究工程",
    "skills.engineering.1": "PyTorch 实验",
    "skills.engineering.2": "CUDA 相关流程",
    "skills.engineering.3": "可复现实验消融",
    "skills.engineering.4": "远程 GPU 运行",
    "skills.software.title": "编程与工具",
    "skills.software.1": "Python",
    "skills.software.2": "JavaScript 与 TypeScript",
    "skills.software.3": "Swift 与 iOS 原型",
    "skills.software.4": "Git、Linux 与数据管线",
    "work.kicker": "代表工作",
    "work.title": "以机制和评估为核心的研究项目。",
    "work.es.time": "2026 · 预印本",
    "work.es.title": "用于预算推理的弹性谱状态空间模型",
    "work.es.body":
      "提出 ES-SSM，在完整谱容量下训练一次，并通过掩码归一化和输入自适应谱门控，在部署时弹性激活有序谱通道。",
    "work.es.stack": "PyTorch · CUDA · FFT 卷积 · 长上下文基准",
    "work.fmri.time": "2024–2025 · 论文方向",
    "work.fmri.title": "基于 fMRI 时间序列的因果指纹识别",
    "work.fmri.body":
      "重建用于主体和任务指纹识别的大脑因果动态，将因果时序建模与可解释神经信号连接起来。",
    "work.fmri.stack": "fMRI · 因果动态 · 时序建模 · 健康 AI",
    "work.eeg.time": "2023 · 硕士项目",
    "work.eeg.title": "用于 EEG 脑活动模式的机器学习",
    "work.eeg.body":
      "构建结合 CNN 空间特征提取、LSTM 时序建模、注意力、自编码器预训练和迁移学习的深度学习流程。",
    "work.eeg.stack": "CNN · LSTM · 注意力 · 自编码器 · ResNet50",
    "publications.kicker": "论文",
    "publications.title": "发表文章",
    "publications.es.type": "预印本",
    "publications.es.venue": "arXiv · 2026",
    "publications.es.title": "用于预算推理的弹性谱状态空间模型",
    "publications.fmri.type": "期刊论文",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title": "使用 fMRI 时间序列数据重建用于主体和任务指纹识别的大脑因果动态",
    "publications.bcb.type": "会议论文",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "口头报告",
    "publications.bcb.title": "基于因果性的 fMRI 时间序列主体与任务指纹识别",
    "projects.kicker": "公开代码",
    "projects.title": "研究项目公开代码。",
    "projects.es.body": "面向高效推理的预算感知状态空间建模，具有弹性谱容量。",
    "projects.health.body": "本地优先的 iOS 健康与训练规划工具，结合个人基线、恢复状态和训练记录。",
    "projects.story.body": "英语学习产品概念，将词汇学习转化为故事化的每日练习。",
    "projects.researchCode": "研究代码",
    "projects.projectPage": "项目主页",
    "education.kicker": "教育与服务",
    "education.title": "教育背景。",
    "education.gmu.degree": "电子与计算机工程博士研究生 · 2024 至今",
    "education.gmu.body": "线性系统、随机过程、卡尔曼滤波、分布式控制与优化、系统辨识。",
    "education.southampton.degree": "理学硕士（MSc）",
    "education.southampton.body": "高级机器学习、深度学习、计算机视觉、贝叶斯学习、主动学习与强化学习。",
    "education.service.title": "学术服务",
    "education.service.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "education.service.body": "评审质量获得 Area Chairs 认可。",
    "contact.kicker": "联系",
    "contact.title": "欢迎交流深度学习、长上下文建模、基于大语言模型的智能体和模型评估方向的合作。",
  },
};

const languageStorageKey = "dachuan-site-language";
const catCompanion = document.querySelector("[data-cat-companion]");
const languageToggle = document.querySelector("[data-lang-toggle]");
const descriptionMeta = document.querySelector('meta[name="description"]');
let currentLanguage = "en";

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

function initCatCompanion() {
  if (!catCompanion) return;

  const resetCat = () => {
    catCompanion.classList.remove("is-awake");
    catCompanion.style.setProperty("--cat-look-x", "0px");
    catCompanion.style.setProperty("--cat-look-y", "0px");
    catCompanion.style.setProperty("--cat-tilt", "0deg");
  };

  catCompanion.addEventListener("pointermove", (event) => {
    const rect = catCompanion.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;

    catCompanion.classList.add("is-awake");
    catCompanion.style.setProperty("--cat-look-x", `${Math.max(-1, Math.min(1, x)) * 5}px`);
    catCompanion.style.setProperty("--cat-look-y", `${Math.max(-1, Math.min(1, y)) * 3}px`);
    catCompanion.style.setProperty("--cat-tilt", `${Math.max(-1, Math.min(1, x)) * 5}deg`);
  });

  catCompanion.addEventListener("pointerleave", resetCat);
  catCompanion.addEventListener("blur", resetCat);
  catCompanion.addEventListener("click", () => {
    document.body.classList.add("cat-is-playing");
    window.setTimeout(() => document.body.classList.remove("cat-is-playing"), 620);
  });
}

document.getElementById("year").textContent = new Date().getFullYear();

if (languageToggle) {
  languageToggle.addEventListener("click", () => {
    setLanguage(currentLanguage === "en" ? "zh" : "en");
  });
}

setLanguage(getInitialLanguage());
initCatCompanion();
