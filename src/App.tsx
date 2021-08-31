import {
    BaseEntityEvent,
    BaseModel,
    BaseModelGenerics,
    CanvasWidget,
} from '@projectstorm/react-canvas-core';
import createEngine, {
    DiagramEngine,
    DiagramModel,
} from '@projectstorm/react-diagrams';
import 'bootstrap/dist/css/bootstrap.min.css';
import React from 'react';
import './App.css';
import { BitcoinNodeManager, update_broadcastable } from './Data/BitcoinNode';
import { ContractModel, Data } from './Data/ContractManager';
import { TransactionModel } from './Data/Transaction';
import { UTXOModel } from './Data/UTXO';
import { SpendLinkFactory } from './UX/Diagram/DiagramComponents/SpendLink/SpendLinkFactory';
import { TransactionNodeFactory } from './UX/Diagram/DiagramComponents/TransactionNode/TransactionNodeFactory';
import { UTXONodeFactory } from './UX/Diagram/DiagramComponents/UTXONode/UTXONodeFactory';
import { SimulationController } from './Simulation';
import { AppNavbar } from './UX/AppNavbar';
import { DemoCanvasWidget } from './UX/Diagram/DemoCanvasWidget';
import { CurrentlyViewedEntity } from './UX/Entity/EntityViewer';
import Collapse from 'react-bootstrap/Collapse';
import './Glyphs.css';
import { BitcoinStatusBar } from './Data/BitcoinStatusBar';
import { ModelManager } from './ModelManager';
import { useDispatch, useSelector } from 'react-redux';
import {
    create_contract_of_type,
    load_new_model,
    selectContract,
} from './AppSlice';
import {
    deselect_entity,
    EntityType,
    selectEntityToView,
    selectShouldViewEntity,
    select_txn,
    select_utxo,
} from './UX/Entity/EntitySlice';
import { OutpointInterface, TXID, TXIDAndWTXIDMap } from './util';
import { Dispatch } from 'redux';
import { last } from 'lodash';

export type SelectedEvent = BaseEntityEvent<BaseModel<BaseModelGenerics>> & {
    isSelected: boolean;
};

function selection_handler(model: DiagramModel, engine: DiagramEngine) {
    let last_entity_id: EntityType = ['NULL', null];
    let last_entity: TransactionModel | UTXOModel | null = null;
    return (contract: ContractModel, entity_id: typeof last_entity_id) => {
        if (entity_id === last_entity_id) {
            // No switch hapenning
            return;
        } else if (
            // new entity is deselected, last entity still selected (will trigger selection_handler again)
            entity_id === null &&
            last_entity &&
            last_entity.isSelected()
        ) {
            last_entity.setSelected(false);
            last_entity = null;
            last_entity_id = ['NULL', null];
            return;
        } else if (entity_id[0] === 'NULL') {
            // Only proceed when selecting
            return;
        } else {
            let entity = null;
            switch (entity_id[0]) {
                case 'TXN':
                    entity = TXIDAndWTXIDMap.get_by_txid_s(
                        contract.txid_map,
                        entity_id[1]
                    );
                    break;
                case 'UTXO':
                    entity = contract.lookup_utxo_model(
                        entity_id[1].hash,
                        entity_id[1].index
                    );
                    break;
            }
            console.log('ENTITY', entity);
            if (!entity) {
                last_entity = null;
                last_entity_id = ['NULL', null];
                return;
            } else if (!entity.isSelected()) {
                // will re-call this code from the selected callback
                last_entity = null;
                last_entity_id = ['NULL', null];
                entity.setSelected(true);
                return;
            } else {
                model.setZoomLevel(100);
                const { clientHeight, clientWidth } = engine.getCanvas();
                const {
                    left,
                    top,
                } = engine.getCanvas().getBoundingClientRect();
                let { x, y } = entity.getPosition();
                x += entity.width / 2;
                y += entity.height;
                const zoomf = model.getZoomLevel() / 100;
                const x_coord = (left + clientWidth / 3 - x) * zoomf;
                const y_coord = (top + clientHeight / 2 - y) * zoomf;
                model.setOffset(x_coord, y_coord);
                last_entity = entity ?? null;
                last_entity_id = entity_id;
                return;
            }
        }
    };
}
function diagram_select_handler(
    dispatch: Dispatch,
    model: DiagramModel,
    engine: DiagramEngine
) {
    return (data: SelectedEvent) => {
        if (data.isSelected === false || data.entity === null) return;
        switch (data.entity.constructor) {
            case TransactionModel:
                {
                    let txn = data.entity as TransactionModel;
                    dispatch(select_txn(txn.get_txid()));
                }
                break;
            case UTXOModel:
                {
                    let utxo = data.entity as UTXOModel;
                    dispatch(
                        select_utxo({
                            hash: utxo.txn.tx.getHash(),
                            index: utxo.utxo.index,
                        })
                    );
                }
                break;
        }
    };
}
function App() {
    const dispatch = useDispatch();
    const [bitcoin_node_bar, set_bitcoin_node_bar] = React.useState(true);
    React.useEffect(() => {
        return window.electron.register('bitcoin-node-bar', (msg: string) => {
            if (msg === 'show') {
                set_bitcoin_node_bar(!bitcoin_node_bar);
            }
        });
    });

    // TODO: This should go somewhere else :(
    React.useEffect(() => {
        return window.electron.register('load_contract', (data: string) => {
            dispatch(load_new_model(JSON.parse(data)));
        });
    });

    React.useEffect(() => {
        window.electron.register(
            'create_contract_from_cache',
            async ([which, args]: [string, string]) => {
                dispatch(create_contract_of_type(which, args));
            }
        );
    });
    const engine: DiagramEngine = createEngine();
    engine.getNodeFactories().registerFactory(new UTXONodeFactory() as any);
    engine
        .getNodeFactories()
        .registerFactory(new TransactionNodeFactory() as any);
    engine.getLinkFactories().registerFactory(new SpendLinkFactory() as any);
    // model is the system of nodes
    const model = new DiagramModel();
    model.setGridSize(50);
    model.setLocked(true);
    const model_manager = new ModelManager(model);
    engine.setModel(model);
    // TODO: multi-component safe memo?
    let memo: [ContractModel, number] | null = null;
    const load_new_contract = (
        data: Data | null,
        counter: number,
        diagram_select: (s: SelectedEvent) => void
    ) => {
        if (memo && data) {
            if (memo[1] === counter) {
                return memo[0];
            }
        }
        const new_contract = new ContractModel(
            diagram_select,
            data ?? { program: [] }
        );
        update_broadcastable(new_contract, new Set());
        if (memo) model_manager.unload(memo[0]);
        memo = [new_contract, counter];
        model_manager.load(new_contract);
        return new_contract;
    };
    return (
        <AppInner
            bitcoin_node_bar={bitcoin_node_bar}
            engine={engine}
            model={model}
            model_manager={model_manager}
            load_new_contract={load_new_contract}
            selection_handler={selection_handler(model, engine)}
        ></AppInner>
    );
}
function AppInner(props: {
    bitcoin_node_bar: boolean;
    engine: DiagramEngine;
    model: DiagramModel;
    model_manager: ModelManager;
    load_new_contract: (
        data: Data | null,
        counter: number,
        diagream_select: (s: SelectedEvent) => void
    ) => ContractModel;
    selection_handler: (c: ContractModel, entity_id: EntityType) => void;
}) {
    let {
        engine,
        model,
        model_manager,
        load_new_contract,
        selection_handler,
    } = props;
    const dispatch = useDispatch();
    const entity_id: EntityType = useSelector(selectEntityToView);

    const show = useSelector(selectShouldViewEntity);
    const details = entity_id !== null && show;

    const [
        timing_simulator_enabled,
        set_timing_simulator_enabled,
    ] = React.useState(false);
    // engine is the processor for graphs, we need to load all our custom factories here

    const [contract_data, counter] = useSelector(selectContract);
    // keep the same contract model around as long as we can...
    const current_contract = load_new_contract(
        contract_data,
        counter,
        diagram_select_handler(dispatch, model, engine)
    );
    selection_handler(current_contract, entity_id);
    /* current_contract is the contract loaded into the
     * backend logic interface */
    /* state.current_contract is the contract loaded into the
     * ux
     * TODO: Can these be unified?
     */
    /* Bitcoin Node State */
    let bitcoin_node_manager = new BitcoinNodeManager({
        model: model,
        current_contract: current_contract,
    });
    const entityViewer = !details ? null : (
        <CurrentlyViewedEntity current_contract={current_contract} />
    );
    const simulator = !timing_simulator_enabled ? null : (
        <SimulationController
            contract={current_contract}
            engine={engine}
            hide={() => set_timing_simulator_enabled(false)}
        />
    );
    return (
        <div className="App">
            <BitcoinNodeManager
                current_contract={current_contract}
                model={model}
                ref={(bnm) =>
                    (bitcoin_node_manager = bnm || bitcoin_node_manager)
                }
            />
            <div className="area">
                <div>
                    <AppNavbar
                        load_new_model={(x: Data) =>
                            dispatch(load_new_model(x))
                        }
                        contract={current_contract}
                        toggle_timing_simulator={() =>
                            set_timing_simulator_enabled(
                                !timing_simulator_enabled
                            )
                        }
                    />
                </div>
                <div className="area-inner">
                    <div className="main-container">
                        <DemoCanvasWidget engine={engine} model={model}>
                            <CanvasWidget engine={engine as any} key={'main'} />
                        </DemoCanvasWidget>
                    </div>
                    <div>{entityViewer}</div>
                    {simulator}
                </div>

                <Collapse in={props.bitcoin_node_bar}>
                    <div>
                        <BitcoinStatusBar
                            api={bitcoin_node_manager}
                        ></BitcoinStatusBar>
                    </div>
                </Collapse>
            </div>
        </div>
    );
}

export default App;
