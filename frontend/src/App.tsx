import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Playground } from './pages/Playground';
import { UnderDevelopment } from './pages/UnderDevelopment';
import { Settings } from './pages/Settings';
import { ModelSettings } from './pages/ModelSettings';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Playground />} />
          <Route path="batch" element={<UnderDevelopment title="批量处理" />} />
          <Route path="history" element={<UnderDevelopment title="处理历史" />} />
          <Route path="settings" element={<Settings />} />
          <Route path="model-settings" element={<ModelSettings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
