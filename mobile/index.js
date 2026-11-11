import { registerRootComponent } from 'expo';
import React from 'react';

import { RuntimeDiagnosticsScreen } from './src/components/RuntimeDiagnosticsScreen';
import {
  clearRuntimeError,
  installGlobalRuntimeErrorHandler,
  readRuntimeError,
  saveRuntimeError,
  setRuntimeErrorListener,
} from './src/lib/runtimeDiagnostics';

installGlobalRuntimeErrorHandler();

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { errorPayload: null };
  }

  componentDidMount() {
    readRuntimeError().then((payload) => {
      if (payload) {
        this.setState({ errorPayload: payload });
      }
    });

    setRuntimeErrorListener((payload) => {
      this.setState({ errorPayload: payload });
    });
  }

  componentWillUnmount() {
    setRuntimeErrorListener(null);
  }

  static getDerivedStateFromError(error) {
    return {
      errorPayload: {
        name: error?.name || 'RenderError',
        message: error?.message || 'Error de render',
        stack: error?.stack || '',
        origin: 'react_boundary',
        isFatal: false,
        timestamp: new Date().toISOString(),
      },
    };
  }

  componentDidCatch(error) {
    saveRuntimeError(error, { origin: 'react_boundary', isFatal: false }).catch(() => {});
  }

  handleClear = async () => {
    await clearRuntimeError();
    this.setState({ errorPayload: null });
  };

  render() {
    if (this.state.errorPayload) {
      return (
        <RuntimeDiagnosticsScreen
          payload={this.state.errorPayload}
          onClear={this.handleClear}
          onRetry={() => this.setState({ errorPayload: null })}
        />
      );
    }
    return this.props.children;
  }
}

let AppComponent;

try {
  AppComponent = require('./App').default;
} catch (error) {
  saveRuntimeError(error, { origin: 'app_import', isFatal: true }).catch(() => {});
  AppComponent = function StartupFailureFallback() {
    return (
      <RuntimeDiagnosticsScreen
        payload={{
          name: error?.name || 'StartupError',
          message: error?.message || 'No fue posible cargar App.js',
          stack: error?.stack || '',
          origin: 'app_import',
          isFatal: true,
          timestamp: new Date().toISOString(),
        }}
      />
    );
  };
}

function Root() {
  return (
    <RootErrorBoundary>
      <AppComponent />
    </RootErrorBoundary>
  );
}

registerRootComponent(Root);
