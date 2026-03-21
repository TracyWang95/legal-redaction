import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Playground } from './pages/Playground';
import { Settings } from './pages/Settings';
import { ModelSettings } from './pages/ModelSettings';
import { History } from './pages/History';
import { Batch } from './pages/Batch';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Playground />} />
          <Route path="batch" element={<Batch />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="model-settings" element={<ModelSettings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
