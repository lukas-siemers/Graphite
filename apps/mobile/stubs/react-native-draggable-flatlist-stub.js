// Web stub for react-native-draggable-flatlist.
// On web there is no gesture-handler drag support, so:
//   - DraggableFlatList renders a plain FlatList and injects drag (noop)
//     and isActive (false) into each renderItem call so renderItem functions
//     that destructure those params don't throw.
//   - ScaleDecorator / OpacityDecorator are plain View wrappers (no animation).
const { FlatList, View } = require('react-native');
const React = require('react');

function DraggableFlatList({ renderItem, onDragEnd, ...props }) {
  // Inject drag noop and isActive=false so renderItem never receives undefined.
  function wrappedRenderItem(params) {
    return renderItem({ ...params, drag: function() {}, isActive: false });
  }
  return React.createElement(FlatList, { ...props, renderItem: wrappedRenderItem });
}

function ScaleDecorator({ children }) {
  return React.createElement(View, null, children);
}

function OpacityDecorator({ children }) {
  return React.createElement(View, null, children);
}

module.exports = {
  default: DraggableFlatList,
  DraggableFlatList: DraggableFlatList,
  ScaleDecorator: ScaleDecorator,
  OpacityDecorator: OpacityDecorator,
};
