using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;

[assembly: AssemblyVersion("0.5.2.0")]
[assembly: AssemblyTitle("关序")]
[assembly: AssemblyProduct("关序")]
[assembly: AssemblyDescription("关注迁移与审阅工具")]

namespace FollowDesk {
    public sealed class LedgerRow {
        public int Id {get;set;} public string Name {get;set;} public string Account {get;set;}
        public string Main {get;set;} public string Alt {get;set;} public string Note {get;set;}
        public bool Done { get { return Alt=="done" || ((Main=="done" || Main=="already") && Alt=="skip_not_following"); } }
        public bool Held { get { return !Done && (Main=="skip_restricted" || Main=="skip_protected" || Main=="skip_unknown" || Main=="id_check_fail" || Alt=="skip_id_fail"); } }
        public bool Retryable { get { return !Done && (Main=="skip_unknown" || Main=="id_check_fail" || Main=="follow_fail" || Main=="risk_paused" || Alt=="skip_id_fail" || Alt=="unfollow_fail" || Alt=="risk_paused"); } }
        public bool Pending { get { return !Done && !Held; } }
        public string MainLabel {get {return Main=="done" ? "已关注" : Main=="already" ? "原已关注" : Label(Main);}}
        public string AltLabel {get {return Alt=="done" ? "已取关" : Label(Alt);}}
        static string Label(string s) {
            switch(s) {
                case "skip_restricted": return "受限保留";
                case "skip_protected": return "名单拦截";
                case "skip_not_following": return "已未关注";
                case "risk_paused": return "已暂停";
                case "id_check_fail": case "skip_id_fail": return "身份待核对";
                case "skip_unknown": return "待人工复核";
                case "follow_fail": case "unfollow_fail": return "复查失败";
                case "": case null: return "待处理";
                default: return s;
            }
        }
    }
    public sealed class Snapshot { public string date {get;set;} public int count {get;set;} }
    public sealed class Overview {
        public LedgerRow[] ledger {get;set;} public Snapshot snapshot {get;set;} public bool canCompare {get;set;}
        public Dictionary<string,int?> galleries {get;set;} public string report {get;set;}
        public string mainOwner {get;set;} public string altOwner {get;set;}
        public int? registry {get;set;} public string[] warnings {get;set;}
    }
    internal sealed class Desk {
        public readonly Window Window;
        readonly string root;
        readonly TaskRunner runner, reader, galleryRunner;
        readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
        readonly DispatcherTimer timer = new DispatcherTimer { Interval=TimeSpan.FromMilliseconds(120) };
        readonly List<Button> localButtons = new List<Button>();
        readonly List<Button> exclusiveButtons = new List<Button>();
        readonly Dictionary<string,string> galleryButtons = new Dictionary<string,string> {{"Review","review"},{"Stale","stale"},{"Suspect","suspect"}};
        Overview data;
        bool busy, refreshing, refreshPending, stopping, galleryOpen, galleryStopping, closeRequested;
        internal Desk(string projectRoot) {
            root=projectRoot; runner=new TaskRunner(root); reader=new TaskRunner(root); galleryRunner=new TaskRunner(root);
            using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("FollowDesk.Window")) Window=(Window)XamlReader.Load(stream);
            using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("FollowDesk.Icon")) {
                var icon=new IconBitmapDecoder(stream,BitmapCreateOptions.PreservePixelFormat,BitmapCacheOption.OnLoad);
                Window.Icon=icon.Frames.OrderByDescending(frame=>frame.PixelWidth).First();
            }
            var workArea=SystemParameters.WorkArea;
            Window.MinWidth=Math.Min(Window.MinWidth,workArea.Width);
            Window.MinHeight=Math.Min(Window.MinHeight,workArea.Height);
            Window.Width=Math.Max(Window.MinWidth,Math.Min(Window.Width,workArea.Width-20));
            Window.Height=Math.Max(Window.MinHeight,Math.Min(Window.Height,workArea.Height-22));
            Window.SourceInitialized+=(s,e)=>TintCaption();
            ApplyPaperFinish();
            LoadArtwork();
            foreach(var name in new [] {"Home","Ledger","Actions","Log"}) {
                var nav=Get<RadioButton>("Nav"+name);
                nav.Checked+=(s,e)=>Page(name);
            }
            foreach(var entry in galleryButtons) {
                string role=entry.Value;
                Get<Button>(entry.Key).Click+=async(s,e)=>{
                    if(busy || galleryOpen || refreshing) return;
                    try { await RunGallery("打开审阅画廊",role); } catch(Exception ex) { Message(ex.Message); }
                };
            }
            LocalButton("Check",()=>Run("项目自检","check"));
            LocalButton("Compare",()=>Run("快照变化对比","diff"));
            LocalButton("ResetHeld",()=>Run("重置异常挂起记录","reset-held"));
            ExclusiveButton("Rebuild",()=>Run("重建三个画廊","gallery","all"));
            ExclusiveButton("Online",()=>Confirm("更新审阅数据？","将使用大号读取关注列表和作品，核验后更新本地快照和三个画廊。关注较多时可能需要较长时间。")
                ? Run("在线更新审阅数据","refresh") : Task.FromResult(0));
            ExclusiveButton("Registry",()=>Run("刷新大号取关登记表","registry"));
            ExclusiveButton("Transfer",()=>Confirm("开始增量迁移？","将核对当前登录的两个账号，执行大号关注和小号取关。")
                ? Run("增量迁移","transfer") : Task.FromResult(0));
            LocalButton("Preview",()=>ListAction("Preview"));
            foreach(var name in new[]{"Dry","Execute"}) {
                string action=name; ExclusiveButton(name,()=>ListAction(action));
            }
            Get<Button>("Browse").Click+=(s,e)=>{
                var dialog=new OpenFileDialog {Filter="决定名单与清单 (*.txt;*.tsv;*.csv)|*.txt;*.tsv;*.csv|所有文件 (*.*)|*.*",CheckFileExists=true};
                if(dialog.ShowDialog(Window)==true) Get<TextBox>("ListFile").Text=dialog.FileName;
            };
            Get<Button>("Refresh").Click+=async(s,e)=>await Refresh();
            Get<Button>("Stop").Click+=(s,e)=>Stop(false);
            Get<Button>("ShowLog").Click+=(s,e)=>Get<RadioButton>("NavLog").IsChecked=true;
            Get<Button>("Report").Click+=(s,e)=>{
                try { var file=Path.Combine(root,"data","doctor_report.txt");
                    if(!File.Exists(file)) throw new IOException("请先运行项目自检。");
                    lines.Enqueue("—— 最近自检报告 ——");
                    foreach(var line in File.ReadLines(file,Encoding.UTF8)) lines.Enqueue(line);
                    Flush(); Get<RadioButton>("NavLog").IsChecked=true;
                } catch(Exception ex) { Message(ex.Message); }
            };
            Get<TextBox>("Search").TextChanged+=(s,e)=>Filter();
            Get<CheckBox>("PendingOnly").Checked+=(s,e)=>Filter();
            Get<CheckBox>("PendingOnly").Unchecked+=(s,e)=>Filter();
            timer.Tick+=(s,e)=>Flush();
            Window.Loaded+=async(s,e)=>{timer.Start(); await Refresh();};
            Window.Closing+=(s,e)=>{ if(busy || galleryOpen) { e.Cancel=true; Stop(true); } };
            Window.Closed+=(s,e)=>{timer.Stop(); reader.Dispose(); runner.Dispose(); galleryRunner.Dispose();};
        }
        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
        void TintCaption() {
            if(SystemParameters.HighContrast) return;
            var hwnd=new System.Windows.Interop.WindowInteropHelper(Window).Handle;
            // Windows 11 recognizes caption and text colors; older Windows retains its system frame.
            SetFrameColor(hwnd,35,"HeaderPaper");
            SetFrameColor(hwnd,36,"Ink");
        }
        void SetFrameColor(IntPtr hwnd,int attribute,string key) {
            var c=((SolidColorBrush)Window.FindResource(key)).Color;
            int color=c.R | (c.G<<8) | (c.B<<16);
            DwmSetWindowAttribute(hwnd,attribute,ref color,sizeof(int));
        }
        void ApplyPaperFinish() {
            // One small, deterministic grain tile supplies the paper and printed ink at every DPI.
            const int size=160;
            var alpha=new byte[size*size*4];
            var random=new Random(2719);
            for(int p=0;p<alpha.Length;p+=4) {
                byte tone=random.Next(2)==0?(byte)0:(byte)255;
                alpha[p]=tone; alpha[p+1]=tone; alpha[p+2]=tone;
                alpha[p+3]=(byte)random.Next(1,9);
            }
            var bitmap=BitmapSource.Create(size,size,96,96,PixelFormats.Bgra32,null,alpha,size*4);
            bitmap.Freeze();
            var bounds=new Rect(0,0,size,size);
            var grain=new ImageBrush(bitmap){TileMode=TileMode.Tile,ViewportUnits=BrushMappingMode.Absolute,Viewport=bounds};
            grain.Freeze();
            var paper=new DrawingGroup();
            using(var drawing=paper.Open()) {
                drawing.DrawRectangle((Brush)Window.FindResource("Paper"),null,bounds);
                drawing.DrawRectangle(grain,null,bounds);
            }
            paper.Freeze();
            var paperBrush=new DrawingBrush(paper){TileMode=TileMode.Tile,ViewportUnits=BrushMappingMode.Absolute,Viewport=bounds};
            paperBrush.Freeze(); Get<Grid>("PaperPage").Background=paperBrush;

            var panel=new Rect(0,0,640,146);
            var print=new DrawingGroup(){ClipGeometry=new RectangleGeometry(panel)};
            using(var drawing=print.Open()) {
                drawing.DrawRectangle((Brush)Window.FindResource("FiredClay"),null,panel);
                drawing.DrawRectangle(grain,null,panel);
                var fineLine=new Pen(new SolidColorBrush(Color.FromArgb(33,255,233,199)),0.75);
                // Curves are confined to the right half and follow the shape of the progress dial.
                for(int i=0;i<18;i++) {
                    double x=244+i*7.4;
                    var curve=new StreamGeometry();
                    using(var path=curve.Open()) {
                        path.BeginFigure(new Point(x,154),false,false);
                        path.BezierTo(new Point(x+118,80),new Point(x+24,8),new Point(x+205,-13),true,false);
                    }
                    curve.Freeze(); drawing.DrawGeometry(null,fineLine,curve);
                }
            }
            print.Freeze();
            var ink=new DrawingBrush(print){ViewboxUnits=BrushMappingMode.Absolute,Viewbox=panel,Stretch=Stretch.Fill};
            ink.Freeze(); Get<Border>("ProgressCard").Background=ink;
        }
        void LoadArtwork() {
            using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("FollowDesk.ReviewArt")) {
                var frame=BitmapDecoder.Create(stream,BitmapCreateOptions.PreservePixelFormat,BitmapCacheOption.OnLoad).Frames[0];
                int i=0;
                foreach(var name in new[]{"Review","Stale","Suspect"}) {
                    int left=i*frame.PixelWidth/3, right=(i+1)*frame.PixelWidth/3;
                    var crop=new CroppedBitmap(frame,new Int32Rect(left,0,right-left,frame.PixelHeight));
                    var brush=new ImageBrush(crop){Stretch=Stretch.UniformToFill};
                    brush.Freeze();
                    Get<Border>(name+"Art").Background=brush;
                    i++;
                }
            }
        }
        void ShowProgress(LedgerRow[] rows) {
            int completed=rows==null?0:rows.Count(r=>r.Done);
            int restricted=rows==null?0:rows.Count(r=>r.Held);
            Get<TextBlock>("CompletedCount").Text=rows==null?"—":completed.ToString("N0");
            Get<TextBlock>("RestrictedLabel").Text="受限保留 "+(rows==null?"—":restricted.ToString());
            Get<TextBlock>("PendingLabel").Text="待处理 "+(rows==null?"—":(rows.Length-completed-restricted).ToString());
            double ratio=rows==null || rows.Length==0?0:(double)completed/rows.Length;
            Get<TextBlock>("ProgressText").Text=rows==null || rows.Length==0?"—":ratio.ToString("0.#%",CultureInfo.InvariantCulture);
            Get<System.Windows.Shapes.Path>("CompleteArc").Data=RingSegment(0,ratio);
            double retained=rows==null || rows.Length==0?0:(double)restricted/rows.Length;
            Get<System.Windows.Shapes.Path>("RestrictedArc").Data=RingSegment(ratio,retained);
        }
        static Geometry RingSegment(double start,double fraction) {
            const double radius=39, center=47;
            if(fraction<=0) return null;
            if(fraction>=1) return new EllipseGeometry(new Point(center,center),radius,radius);
            Func<double,Point> point=t=>new Point(center+radius*Math.Sin(t*2*Math.PI),center-radius*Math.Cos(t*2*Math.PI));
            var geometry=new StreamGeometry();
            using(var ctx=geometry.Open()) {
                ctx.BeginFigure(point(start),false,false);
                ctx.ArcTo(point(start+fraction),new Size(radius,radius),0,fraction>.5,SweepDirection.Clockwise,true,false);
            }
            geometry.Freeze(); return geometry;
        }
        T Get<T>(string name) where T:FrameworkElement { return (T)Window.FindName(name); }
        void Page(string name) {
            foreach(var p in new[]{"Home","Ledger","Actions","Log"}) Get<FrameworkElement>(p).Visibility=p==name?Visibility.Visible:Visibility.Collapsed;
        }
        void LocalButton(string name,Func<Task> action) {
            var button=Get<Button>(name); localButtons.Add(button);
            button.Click+=async(s,e)=>{ if(busy || refreshing) return; try{await action();}catch(Exception ex){Message(ex.Message);} };
        }
        void ExclusiveButton(string name,Func<Task> action) {
            var button=Get<Button>(name); exclusiveButtons.Add(button);
            button.Click+=async(s,e)=>{ if(busy || galleryOpen || refreshing) return; try{await action();}catch(Exception ex){Message(ex.Message);} };
        }
        bool Confirm(string title,string detail) {
            return MessageBox.Show(Window,detail,title,MessageBoxButton.YesNo,MessageBoxImage.Question,MessageBoxResult.No)==MessageBoxResult.Yes;
        }
        void Message(string message) { MessageBox.Show(Window,message,Window.Title,MessageBoxButton.OK,MessageBoxImage.Information); }
        void Status(string text) {
            Get<TextBlock>("Status").Text=text;
            string brush=text.Contains("失败")?"Danger":
                text.Contains("提醒") || text.Contains("中止")?"Caution":
                (busy || galleryOpen) && text.Contains("运行")?"Accent":"SageInk";
            Get<System.Windows.Shapes.Ellipse>("StatusDot").Fill=(Brush)Window.FindResource(brush);
        }
        void Controls() {
            bool canLocal=!busy && !refreshing;
            bool canExclusive=canLocal && !galleryOpen;
            foreach(var b in localButtons) b.IsEnabled=canLocal;
            foreach(var b in exclusiveButtons) b.IsEnabled=canExclusive;
            var compare=Get<Button>("Compare");
            compare.IsEnabled=canLocal && data!=null && data.canCompare;
            compare.ToolTip=data!=null && data.canCompare ? "对比并保存本轮变化清单" : "完成两次在线更新后可以对比变化";
            var rebuild=Get<Button>("Rebuild");
            rebuild.IsEnabled=canExclusive && data!=null && data.snapshot!=null;
            rebuild.ToolTip=data!=null && data.snapshot!=null ? "用已采集的本地数据重建画廊" : "先在线更新一次，生成关注快照";
            Get<Button>("ResetHeld").IsEnabled=canLocal && data!=null && data.ledger!=null && data.ledger.Any(r=>r.Retryable);
            foreach(var name in galleryButtons.Keys) {
                int? count=null;
                if(data!=null && data.galleries!=null) data.galleries.TryGetValue(galleryButtons[name],out count);
                Get<Button>(name).IsEnabled=canExclusive && count.HasValue;
            }
            Get<Button>("Stop").IsEnabled=!stopping && !galleryStopping && (busy || galleryOpen);
            Get<Button>("Stop").Visibility=(busy || galleryOpen)?Visibility.Visible:Visibility.Collapsed;
            Get<Button>("Refresh").IsEnabled=canLocal;
        }
        void Stop(bool close) {
            bool stopTask=busy && !stopping;
            bool stopGallery=galleryOpen && !galleryStopping && (close || !busy);
            if(!stopTask && !stopGallery) { if(close) closeRequested=true; return; }
            string detail=stopTask && !stopGallery && galleryOpen
                ? "将结束本次本地任务，已打开的审阅画廊将保持运行。"
                : "将结束本次任务及其打开的浏览器。已发生的账号操作可能需要重新核对。";
            if(!Confirm(close?"中止任务并关闭管理台？":"中止当前任务？",detail)) return;
            closeRequested=closeRequested || close;
            try {
                if(stopTask) { stopping=true; runner.Stop(); }
                if(stopGallery) { galleryStopping=true; galleryRunner.Stop(); }
                Status("正在中止任务…");
            } catch(Exception ex) {
                if(stopTask) stopping=false;
                if(stopGallery) galleryStopping=false;
                closeRequested=false;
                Message(ex.Message);
            }
            Controls();
        }
        Task ListAction(string action) {
            string file=Get<TextBox>("ListFile").Text.Trim().Trim('"');
            if(!Path.IsPathRooted(file)) file=Path.Combine(root,file);
            if(!File.Exists(file)) throw new IOException("请选择存在的决定名单或 CSV 清单。");
            file=Path.GetFullPath(file);
            string limit=Get<TextBox>("Limit").Text.Trim(); int n;
            if(limit!="" && (!int.TryParse(limit,NumberStyles.None,CultureInfo.InvariantCulture,out n) || n<1))
                throw new ArgumentException("本次处理上限须为正整数，或留空处理全部候选。");
            var args=new List<string>{action=="Preview"?"preview":"unfollow",file};
            if(limit!="") args.AddRange(new[]{"--limit",limit});
            if(action=="Execute") {
                if(!Confirm("确认大号执行取关？","名单："+file+"\n数量上限："+(limit==""?"全部候选":limit)+"\n将对核对通过的账号实际执行取关。")) return Task.FromResult(0);
                args.Add("--execute");
            }
            return Run(action=="Preview"?"本地名单预览":action=="Dry"?"在线核对名单":"执行大号取关",args.ToArray());
        }
        async Task RunGallery(string title,string role) {
            if(busy || galleryOpen || refreshing) return;
            galleryOpen=true; galleryStopping=false; Controls(); Status(title+" · 正在运行");
            lines.Enqueue(Environment.NewLine+"["+DateTime.Now.ToString("HH:mm:ss")+"] "+title);
            int warn=0;
            Action<string> output=line=>{
                if(line.Contains("[WARN]")) Interlocked.Exchange(ref warn,1);
                lines.Enqueue(line);
            };
            try {
                int code=await galleryRunner.Run(new[]{"scripts/run.mjs","open",role},output,output);
                string result=galleryStopping?"已中止":code!=0?"失败（退出码 "+code+"）":warn!=0?"完成，有提醒":"已完成";
                if(!busy) Status(title+" · "+result);
                lines.Enqueue(title+" · "+result);
            } catch(Exception ex) {
                if(!busy) Status(title+" · 启动或执行失败");
                lines.Enqueue(ex.Message);
            } finally {
                Flush(); galleryOpen=false; galleryStopping=false; Controls();
            }
            if(closeRequested) { if(!busy) Window.Close(); }
            else await Refresh();
        }
        async Task Run(string title,params string[] args) {
            if(busy || refreshing) return;
            busy=true; stopping=false; Controls(); Status(title+" · 正在运行");
            lines.Enqueue(Environment.NewLine+"["+DateTime.Now.ToString("HH:mm:ss")+"] "+title);
            if(args.Length==0 || args[0]!="open") Get<RadioButton>("NavLog").IsChecked=true;
            int warn=0;
            Action<string> output=line=>{
                if(line.Contains("[WARN]")) Interlocked.Exchange(ref warn,1);
                lines.Enqueue(line);
            };
            try {
                int code=await runner.Run(new[]{"scripts/run.mjs"}.Concat(args).ToArray(),output,output);
                string result=stopping?"已中止":code!=0?"失败（退出码 "+code+"）":warn!=0?"完成，有提醒":"已完成";
                Status(title+" · "+result); lines.Enqueue(title+" · "+result);
            } catch(Exception ex){Status(title+" · 启动或执行失败"); lines.Enqueue(ex.Message);}
            finally {
                Flush(); busy=false; stopping=false; Controls();
            }
            if(closeRequested) { if(!galleryOpen) Window.Close(); }
            else await Refresh();
        }
        void Flush() {
            if(lines.IsEmpty) return;
            var chunk=new StringBuilder(); string line;
            while(chunk.Length<100000 && lines.TryDequeue(out line)) chunk.AppendLine(line);
            var box=Get<TextBox>("Output");
            string current=box.Text;
            if(current.Length>320000) {
                int start=current.Length-220000;
                int nl=current.IndexOf('\n',start);
                if(nl>=0 && nl+1<current.Length) start=nl+1;
                else if(start<current.Length && char.IsLowSurrogate(current[start])) start++;
                box.Text=current.Substring(start);
            }
            box.AppendText(chunk.ToString()); box.ScrollToEnd();
            Get<TextBlock>("LogEmpty").Visibility=Visibility.Collapsed;
        }
        async Task Refresh() {
            if(busy) return;
            if(refreshing) { refreshPending=true; return; }
            do {
                refreshPending=false;
                refreshing=true; Controls();
                try {
                    var json=new StringBuilder(); var errors=new StringBuilder();
                    int code=await reader.Run(new[]{"desktop/status.mjs"},s=>json.AppendLine(s),s=>errors.AppendLine(s));
                    if(code!=0) throw new IOException(errors.ToString().Trim());
                    data=new JavaScriptSerializer {MaxJsonLength=16000000}.Deserialize<Overview>(json.ToString());
                    if(data==null) throw new IOException("本地数据没有返回结果。");
                    ShowData();
                } catch(Exception ex) {
                    data=null; ShowData();
                    Get<TextBlock>("Warnings").Text="本地数据读取失败："+ex.Message;
                } finally {refreshing=false; Controls();}
            } while(refreshPending && !busy && !closeRequested);
        }
        void ShowData() {
            ShowProgress(data==null?null:data.ledger);
            ((System.Windows.Documents.Run)Window.FindName("MainOwner")).Text=data==null || data.mainOwner==null?"尚未绑定":data.mainOwner;
            ((System.Windows.Documents.Run)Window.FindName("AltOwner")).Text=data==null || data.altOwner==null?"尚未绑定":data.altOwner;
            var snap=data==null?null:data.snapshot;
            Get<TextBlock>("Following").Text=snap==null?"—":snap.count.ToString("N0");
            Get<TextBlock>("LedgerCount").Text=data==null || data.ledger==null?"—":data.ledger.Length.ToString("N0");
            Get<TextBlock>("RegistryCount").Text=data==null || !data.registry.HasValue?"—":data.registry.Value.ToString("N0");
            Get<TextBlock>("Snapshot").Text="关注快照尚不可用";
            var notices=new List<string>();
            if(snap!=null) {
                var when=DateTimeOffset.Parse(snap.date,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind);
                Get<TextBlock>("Snapshot").Text="大号关注快照　"+when.ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                if(DateTimeOffset.Now-when>TimeSpan.FromHours(72)) notices.Add("关注快照超过 72 小时，画廊展示采集时的状态。");
            }
            if(data!=null && data.warnings!=null) notices.AddRange(data.warnings);
            Get<TextBlock>("Warnings").Text=String.Join("\n",notices);
            Get<TextBlock>("CheckResult").Text=(data==null?"—":data.report??"—");
            foreach(var item in galleryButtons) {
                int? count=null;
                if(data!=null && data.galleries!=null) data.galleries.TryGetValue(item.Value,out count);
                Get<TextBlock>(item.Key+"Count").Text=count.HasValue?count.Value+" 个账号":"需重建";
            }
            Filter();
        }
        void Filter() {
            var all=data==null || data.ledger==null?new LedgerRow[0]:data.ledger;
            var q=Get<TextBox>("Search").Text.Trim();
            var rows=all.Where(r=>(Get<CheckBox>("PendingOnly").IsChecked!=true || r.Pending) &&
                ((r.Name??"").IndexOf(q,StringComparison.OrdinalIgnoreCase)>=0 || (r.Account??"").IndexOf(q,StringComparison.OrdinalIgnoreCase)>=0)).ToList();
            Get<DataGrid>("Rows").ItemsSource=rows;
            Get<TextBlock>("MatchCount").Text=rows.Count+" / "+all.Length;
        }
    }
    internal static class Program {
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd,int state);
        [STAThread] public static void Main() {
            try {
                string root=AppDomain.CurrentDomain.BaseDirectory;
                string id;
                using(var sha=SHA256.Create()) id=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-","");
                bool first;
                using(var single=new Mutex(true,@"Local\DouyinFollowDesk-"+id,out first)) {
                    if(!first) {
                        using(var self=Process.GetCurrentProcess()) {
                            string selfFile=self.MainModule.FileName;
                            foreach(var other in Process.GetProcessesByName(self.ProcessName)) {
                                using(other) {
                                    try {
                                        if(other.Id==self.Id || other.MainWindowHandle==IntPtr.Zero) continue;
                                        if(!String.Equals(other.MainModule.FileName,selfFile,StringComparison.OrdinalIgnoreCase)) continue;
                                        if(IsIconic(other.MainWindowHandle)) ShowWindow(other.MainWindowHandle,9);
                                        SetForegroundWindow(other.MainWindowHandle); break;
                                    } catch(Win32Exception) {
                                        continue;
                                    } catch(InvalidOperationException) {
                                        continue;
                                    }
                                }
                            }
                        } return;
                    }
                    var app=new Application();
                    app.Run(new Desk(root).Window);
                }
            } catch(Exception ex) {MessageBox.Show(ex.Message,"关序启动失败",MessageBoxButton.OK,MessageBoxImage.Error);}
        }
    }
}
